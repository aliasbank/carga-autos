export const CHARGE_DURATION_MINUTES = 120;
export const HANDOVER_MINUTES = 5;
export const NO_SHOW_GRACE_MINUTES = 10;

type QueueEntry = {
  id: number;
  status: "queued" | "active";
  scheduled_start: string;
  started_at: string | null;
  duration_minutes: number;
};

type MissedTurn = { id: number; charger_id: number; profile_id: number };

function isoPlusMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function laterOf(first: string, second: string) {
  return new Date(first).getTime() >= new Date(second).getTime() ? first : second;
}

/** Keeps pending turns in a charger in a contiguous charge + handover sequence. */
export async function rebalanceQueue(database: D1Database, chargerId: number) {
  const entries = await database.prepare(`
    SELECT id, status, scheduled_start, started_at, duration_minutes
    FROM charging_queue
    WHERE charger_id = ? AND status IN ('queued', 'active')
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, scheduled_start ASC, id ASC
  `).bind(chargerId).all<QueueEntry>();

  const openBlock = await database.prepare(`
    SELECT id FROM charger_blocks
    WHERE charger_id = ? AND status = 'open'
    LIMIT 1
  `).bind(chargerId).first<{ id: number }>();

  // A physical vehicle without a registered turn means there is no reliable
  // availability time. Preserve the existing order until somebody confirms the
  // charger is free; the queue will be recalculated from that actual moment.
  if (openBlock) {
    const tail = entries.results.filter((entry) => entry.status === "queued").at(-1);
    return tail
      ? isoPlusMinutes(tail.scheduled_start, tail.duration_minutes + HANDOVER_MINUTES)
      : new Date().toISOString();
  }

  const lastCompleted = await database.prepare(`
    SELECT ended_at FROM charging_queue
    WHERE charger_id = ? AND status = 'completed' AND ended_at IS NOT NULL
    ORDER BY ended_at DESC LIMIT 1
  `).bind(chargerId).first<{ ended_at: string }>();

  let nextAvailable = new Date().toISOString();
  if (lastCompleted?.ended_at) {
    nextAvailable = laterOf(nextAvailable, isoPlusMinutes(lastCompleted.ended_at, HANDOVER_MINUTES));
  }

  for (const entry of entries.results) {
    if (entry.status === "active") {
      const start = entry.started_at || entry.scheduled_start;
      nextAvailable = laterOf(nextAvailable, isoPlusMinutes(start, entry.duration_minutes + HANDOVER_MINUTES));
      continue;
    }

    if (nextAvailable !== entry.scheduled_start) {
      await database.prepare("UPDATE charging_queue SET scheduled_start = ? WHERE id = ?")
        .bind(nextAvailable, entry.id).run();
    }
    nextAvailable = isoPlusMinutes(nextAvailable, entry.duration_minutes + HANDOVER_MINUTES);
  }
  return nextAvailable;
}

/**
 * Requeues only the person currently at the head of an available charger.
 * A turn may expire only after its scheduled start plus the no-show grace
 * period; an active session always takes precedence over this rule.
 */
export async function requeueNoShows(database: D1Database, now = new Date()) {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - NO_SHOW_GRACE_MINUTES * 60_000).toISOString();
  const missed = await database.prepare(`
    SELECT q.id, q.charger_id, q.profile_id
    FROM charging_queue q
    WHERE q.status = 'queued'
      AND q.scheduled_start <= ?
      AND NOT EXISTS (
        SELECT 1 FROM charger_blocks block
        WHERE block.charger_id = q.charger_id AND block.status = 'open'
      )
      AND NOT EXISTS (
        SELECT 1 FROM charging_queue active
        WHERE active.charger_id = q.charger_id AND active.status = 'active'
      )
      AND q.id = (
        SELECT head.id FROM charging_queue head
        WHERE head.charger_id = q.charger_id AND head.status = 'queued'
        ORDER BY head.scheduled_start ASC, head.id ASC
        LIMIT 1
      )
    ORDER BY q.scheduled_start ASC, q.id ASC
  `).bind(cutoff).all<MissedTurn>();

  let requeued = 0;
  for (const turn of missed.results) {
    // The status condition makes this safe if the user marked their vehicle as
    // connected while the automatic job was already evaluating the queue.
    const cancelled = await database.prepare(`
      UPDATE charging_queue
      SET status = 'cancelled', ended_at = ?
      WHERE id = ? AND status = 'queued'
    `).bind(nowIso, turn.id).run();
    if (Number(cancelled.meta.changes) !== 1) continue;

    // Rebalance before inserting the new record so the replacement is placed
    // after everyone already waiting, not in the position that just expired.
    const tailStart = await rebalanceQueue(database, turn.charger_id);
    await database.prepare(`
      INSERT INTO charging_queue (charger_id, profile_id, scheduled_start)
      VALUES (?, ?, ?)
    `).bind(turn.charger_id, turn.profile_id, tailStart).run();
    await rebalanceQueue(database, turn.charger_id);
    requeued += 1;
  }
  return requeued;
}
