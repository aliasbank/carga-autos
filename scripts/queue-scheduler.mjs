const endpoint = String(process.env.QUEUE_AUTOMATION_URL || "http://cargadores:8787/api/queue-automation");
const token = String(process.env.QUEUE_AUTOMATION_TOKEN || "").trim();
const intervalSeconds = Number(process.env.QUEUE_AUTOMATION_INTERVAL_SECONDS || "30");

if (!/^[a-f0-9]{64}$/i.test(token)) {
  throw new Error("QUEUE_AUTOMATION_TOKEN debe ser un secreto hexadecimal de 64 caracteres.");
}
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 15 || intervalSeconds > 300) {
  throw new Error("QUEUE_AUTOMATION_INTERVAL_SECONDS debe estar entre 15 y 300.");
}

let running = false;

async function processQueue() {
  if (running) return;
  running = true;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`El servicio respondió ${response.status}.`);
    const result = await response.json();
    if (Number(result.requeued) > 0) console.log(`Se reubicaron ${result.requeued} turno(s) por no presentación.`);
  } catch (cause) {
    console.error("No fue posible revisar la fila de cargadores.", cause);
  } finally {
    running = false;
  }
}

await processQueue();
const interval = setInterval(() => { void processQueue(); }, intervalSeconds * 1_000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(interval);
    process.exit(0);
  });
}
