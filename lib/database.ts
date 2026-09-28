import { env } from "cloudflare:workers";

export function getDatabase() {
  if (!env.DB) throw new Error("La base de datos aún no está disponible.");
  return env.DB;
}
