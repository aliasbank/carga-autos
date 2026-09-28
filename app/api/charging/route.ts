import { AuthError, canManageChargers, createLocalAccount, isAdmin, requireUser, resetPassword, type Role } from "@/lib/auth";
import { getDatabase } from "@/lib/database";

type Channel = "app" | "email";
type ChargerAccess = "usuario" | "coordinador";
const HANDOVER_MINUTES = 5;

function error(message: string, status = 400) { return Response.json({ error: message }, { status }); }
function isoPlusMinutes(iso: string, minutes: number) { return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString(); }
function validRole(value: unknown): value is Role { return value === "usuario" || value === "coordinador" || value === "administrador"; }

type QueueEntry = { id: number; status: "queued" | "active"; scheduled_start: string; started_at: string | null; duration_minutes: number };

function laterOf(first: string, second: string) {
  return new Date(first).getTime() >= new Date(second).getTime() ? first : second;
}

/** Keeps every pending turn in a charger in a contiguous 120-minute charge + handover sequence. */
async function rebalanceQueue(database: D1Database, chargerId: number) {
  const entries = await database.prepare(`
    SELECT id, status, scheduled_start, started_at, duration_minutes
    FROM charging_queue
    WHERE charger_id = ? AND status IN ('queued', 'active')
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, scheduled_start ASC, id ASC
  `).bind(chargerId).all<QueueEntry>();

  const lastCompleted = await database.prepare(`
    SELECT ended_at FROM charging_queue
    WHERE charger_id = ? AND status = 'completed' AND ended_at IS NOT NULL
    ORDER BY ended_at DESC LIMIT 1
  `).bind(chargerId).first<{ ended_at: string }>();

  let nextAvailable = new Date().toISOString();
  if (lastCompleted?.ended_at) nextAvailable = laterOf(nextAvailable, isoPlusMinutes(lastCompleted.ended_at, HANDOVER_MINUTES));
  for (const entry of entries.results) {
    if (entry.status === "active") {
      const start = entry.started_at || entry.scheduled_start;
      nextAvailable = laterOf(nextAvailable, isoPlusMinutes(start, entry.duration_minutes + HANDOVER_MINUTES));
      continue;
    }

    // Pending turns are a queue, not fixed calendar appointments: when one is
    // cancelled or finishes early, everyone behind it advances immediately.
    const scheduledStart = nextAvailable;
    if (scheduledStart !== entry.scheduled_start) {
      await database.prepare("UPDATE charging_queue SET scheduled_start = ? WHERE id = ?").bind(scheduledStart, entry.id).run();
    }
    nextAvailable = isoPlusMinutes(scheduledStart, entry.duration_minutes + HANDOVER_MINUTES);
  }
  return nextAvailable;
}

async function dashboard(request: Request) {
  const database = getDatabase();
  const profile = await requireUser(request);
  const chargers = await database.prepare(`
    SELECT c.id, c.code, c.location, c.access_level, c.active,
      q.id AS queue_id, q.profile_id, q.scheduled_start, q.started_at, q.ended_at, q.duration_minutes, q.status, p.alias AS occupant_alias
    FROM chargers c LEFT JOIN charging_queue q ON q.id = (
      SELECT id FROM charging_queue q2 WHERE q2.charger_id = c.id AND q2.status IN ('active','queued')
      ORDER BY CASE q2.status WHEN 'active' THEN 0 ELSE 1 END, q2.scheduled_start ASC LIMIT 1
    ) LEFT JOIN profiles p ON p.id = q.profile_id WHERE c.active = 1 ORDER BY c.location, c.code
  `).all();
  const queue = await database.prepare(`
    SELECT q.id, q.charger_id, q.profile_id, q.scheduled_start, q.started_at, q.ended_at, q.duration_minutes, q.status,
      c.code AS charger_code, c.location, p.alias
    FROM charging_queue q JOIN chargers c ON c.id = q.charger_id JOIN profiles p ON p.id = q.profile_id
    WHERE q.status IN ('queued','active') ORDER BY q.scheduled_start ASC
  `).all();
  const users = isAdmin(profile) ? await database.prepare(`
    SELECT p.id, p.alias, p.phone, p.role, p.is_active, p.can_manage_chargers, a.username, a.last_login_at
    FROM profiles p JOIN accounts a ON a.profile_id = p.id ORDER BY p.role DESC, p.alias ASC
  `).all() : { results: [] };
  return Response.json({
    profile: { ...profile, canManageChargers: canManageChargers(profile) }, chargers: chargers.results, queue: queue.results, users: users.results, now: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  try { return await dashboard(request); }
  catch (cause) {
    if (cause instanceof AuthError) return error(cause.message, cause.status);
    return error(cause instanceof Error ? cause.message : "No fue posible cargar los turnos.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const profile = await requireUser(request);
    const database = getDatabase();
    const action = String(payload.action || "");

    if (action === "profile") {
      const alias = String(payload.alias || "").trim().slice(0, 30);
      const phone = String(payload.phone || "").trim().slice(0, 24);
      const channel: Channel = payload.notificationChannel === "email" ? "email" : "app";
      if (!alias || !phone) return error("Indica un alias y teléfono para recibir avisos.");
      await database.prepare("UPDATE profiles SET alias = ?, phone = ?, notification_channel = ? WHERE id = ?").bind(alias, phone, channel, profile.profileId).run();
      return dashboard(request);
    }

    if (action === "add-charger") {
      if (!canManageChargers(profile)) return error("No tienes permiso para administrar cargadores.", 403);
      const code = String(payload.code || "").trim().toUpperCase().slice(0, 24);
      const location = String(payload.location || "").trim().slice(0, 80);
      const access: ChargerAccess = payload.accessLevel === "coordinador" ? "coordinador" : "usuario";
      if (!code || !location) return error("Indica código y ubicación.");
      await database.prepare("INSERT INTO chargers (code, location, access_level) VALUES (?, ?, ?)").bind(code, location, access).run();
      return dashboard(request);
    }

    if (action === "archive-charger") {
      if (!canManageChargers(profile)) return error("No tienes permiso para administrar cargadores.", 403);
      const chargerId = Number(payload.chargerId);
      const pending = await database.prepare("SELECT id FROM charging_queue WHERE charger_id = ? AND status IN ('active', 'queued')").bind(chargerId).first();
      if (pending) return error("No puedes retirar un cargador con una sesión activa o una fila pendiente.");
      await database.prepare("UPDATE chargers SET active = 0 WHERE id = ?").bind(chargerId).run();
      return dashboard(request);
    }

    if (action === "create-user") {
      if (!isAdmin(profile)) return error("Solo administración puede crear cuentas.", 403);
      const role = validRole(payload.role) ? payload.role : "usuario";
      await createLocalAccount({ username: String(payload.username || ""), password: String(payload.password || ""), alias: String(payload.alias || ""), phone: String(payload.phone || ""), role, canManageChargers: payload.canManageChargers === true });
      return dashboard(request);
    }

    if (action === "update-user") {
      if (!isAdmin(profile)) return error("Solo administración puede modificar cuentas.", 403);
      const profileId = Number(payload.profileId);
      const target = await database.prepare("SELECT id, role, is_active FROM profiles WHERE id = ?").bind(profileId).first<{ id: number; role: Role; is_active: number }>();
      if (!target) return error("No encontramos a la persona seleccionada.", 404);
      const role = validRole(payload.role) ? payload.role : target.role;
      const active = payload.isActive === false ? 0 : 1;
      if (profileId === profile.profileId && (role !== "administrador" || active !== 1)) return error("No puedes quitarte tu propio acceso de administrador.");
      if (target.role === "administrador" && role !== "administrador") {
        const admins = await database.prepare("SELECT COUNT(*) AS total FROM profiles WHERE role = 'administrador' AND is_active = 1").first<{ total: number }>();
        if ((admins?.total ?? 0) <= 1) return error("Debe conservarse al menos un administrador activo.");
      }
      const alias = String(payload.alias || "").trim().slice(0, 30);
      const phone = String(payload.phone || "").trim().slice(0, 24);
      if (!alias || !phone) return error("Alias y teléfono son obligatorios.");
      const canManage = role === "administrador" || payload.canManageChargers === true ? 1 : 0;
      await database.prepare("UPDATE profiles SET alias = ?, phone = ?, role = ?, is_active = ?, can_manage_chargers = ? WHERE id = ?")
        .bind(alias, phone, role, active, canManage, profileId).run();
      const password = String(payload.password || "");
      if (password) await resetPassword(profileId, password);
      return dashboard(request);
    }

    if (action === "join") {
      const chargerId = Number(payload.chargerId);
      const charger = await database.prepare("SELECT id, access_level, active FROM chargers WHERE id = ?").bind(chargerId).first<{ id: number; access_level: ChargerAccess; active: number }>();
      if (!charger?.active) return error("Ese cargador no está disponible.");
      if (charger.access_level === "coordinador" && profile.role === "usuario") return error("Este cargador está reservado para coordinación.", 403);
      const existing = await database.prepare("SELECT id FROM charging_queue WHERE profile_id = ? AND status IN ('queued','active')").bind(profile.profileId).first();
      if (existing) return error("Ya tienes un turno o una carga activa.");
      const scheduled = await rebalanceQueue(database, chargerId);
      await database.prepare("INSERT INTO charging_queue (charger_id, profile_id, scheduled_start) VALUES (?, ?, ?)").bind(chargerId, profile.profileId, scheduled).run();
      await rebalanceQueue(database, chargerId);
      return dashboard(request);
    }

    const queueId = Number(payload.queueId);
    const row = await database.prepare("SELECT charger_id, profile_id, status, scheduled_start FROM charging_queue WHERE id = ?").bind(queueId).first<{ charger_id: number; profile_id: number; status: string; scheduled_start: string }>();
    if (!row) return error("No encontramos ese turno.", 404);
    if (row.profile_id !== profile.profileId && profile.role === "usuario") return error("No puedes modificar el turno de otra persona.", 403);
    if (action === "start") {
      if (row.status !== "queued") return error("Este turno ya no puede iniciarse.");
      const active = await database.prepare("SELECT id FROM charging_queue WHERE charger_id = ? AND status = 'active'").bind(row.charger_id).first();
      if (active) return error("El cargador todavía está en uso.");
      const nextTurn = await database.prepare("SELECT id FROM charging_queue WHERE charger_id = ? AND status = 'queued' ORDER BY scheduled_start ASC, id ASC LIMIT 1").bind(row.charger_id).first<{ id: number }>();
      if (nextTurn?.id !== queueId) return error("Aún hay personas antes de este turno en la fila.");
      if (new Date(row.scheduled_start).getTime() > Date.now()) return error("Aún no es el momento de este turno. El margen de transición de 5 minutos debe concluir antes de conectar.");
      await database.prepare("UPDATE charging_queue SET status = 'active', started_at = ? WHERE id = ?").bind(new Date().toISOString(), queueId).run();
      await rebalanceQueue(database, row.charger_id);
    } else if (action === "finish") {
      if (row.status !== "active") return error("Este turno no está activo.");
      await database.prepare("UPDATE charging_queue SET status = 'completed', ended_at = ? WHERE id = ?").bind(new Date().toISOString(), queueId).run();
      await rebalanceQueue(database, row.charger_id);
    } else if (action === "cancel") {
      if (row.status !== "queued") return error("Solo se pueden cancelar turnos pendientes.");
      await database.prepare("UPDATE charging_queue SET status = 'cancelled', ended_at = ? WHERE id = ?").bind(new Date().toISOString(), queueId).run();
      await rebalanceQueue(database, row.charger_id);
    } else return error("Acción no reconocida.");
    return dashboard(request);
  } catch (cause) {
    if (cause instanceof AuthError) return error(cause.message, cause.status);
    const message = cause instanceof Error && cause.message.includes("UNIQUE") ? "Ese dato ya está registrado." : cause instanceof Error ? cause.message : "No fue posible guardar el cambio.";
    return error(message, 500);
  }
}
