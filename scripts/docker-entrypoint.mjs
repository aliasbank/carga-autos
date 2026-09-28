import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const dataRoot = path.resolve(process.env.APP_DATA_DIR || "/data");
const d1State = path.join(dataRoot, "d1");
const workerEnvFile = path.join(dataRoot, "runtime", "queue-automation.env");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || "8787");
const automationToken = String(process.env.QUEUE_AUTOMATION_TOKEN || "").trim();

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT debe ser un número válido entre 1 y 65535.");
}
if (!/^[a-f0-9]{64}$/i.test(automationToken)) {
  throw new Error("QUEUE_AUTOMATION_TOKEN debe ser un secreto hexadecimal de 64 caracteres.");
}

process.chdir(projectRoot);
mkdirSync(d1State, { recursive: true });
mkdirSync(path.dirname(workerEnvFile), { recursive: true });
writeFileSync(workerEnvFile, `QUEUE_AUTOMATION_TOKEN=${automationToken}\n`, { mode: 0o600 });
chmodSync(workerEnvFile, 0o600);

const wranglerPrefix = [
  "--import", "./scripts/sites-env.mjs",
  "./node_modules/wrangler/bin/wrangler.js",
];

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...wranglerPrefix, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Wrangler terminó con ${signal || `código ${code}`}.`));
    });
  });
}

// Wrangler records applied migrations in the persistent D1 database. This is
// safe to run at each boot and rolls back the current migration if it fails.
await runWrangler([
  "d1", "migrations", "apply", "DB",
  "--local",
  "--config", "dist/server/wrangler.json",
  "--persist-to", d1State,
]);

const server = spawn(process.execPath, [
  ...wranglerPrefix,
  "dev",
  "--config", "dist/server/wrangler.json",
  "--env-file", workerEnvFile,
  "--local",
  "--persist-to", d1State,
  "--ip", host,
  "--port", String(port),
  "--inspector-port", "0",
], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
server.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
