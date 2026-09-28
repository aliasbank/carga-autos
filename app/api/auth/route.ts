import { AuthError, authenticate, createLocalAccount, createSession, currentUser, revokeSession } from "@/lib/auth";
import { getDatabase } from "@/lib/database";

function replyError(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error && error.message.includes("UNIQUE") ? "Ese usuario ya existe." : "No fue posible procesar la solicitud.";
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const count = await getDatabase().prepare("SELECT COUNT(*) AS total FROM accounts").first<{ total: number }>();
    const user = await currentUser(request);
    return Response.json({ setupRequired: (count?.total ?? 0) === 0, user });
  } catch (error) { return replyError(error); }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action || "");
    if (action === "bootstrap") {
      const count = await getDatabase().prepare("SELECT COUNT(*) AS total FROM accounts").first<{ total: number }>();
      if ((count?.total ?? 0) !== 0) return Response.json({ error: "La configuración inicial ya fue completada." }, { status: 409 });
      const account = await createLocalAccount({
        username: String(payload.username || ""), password: String(payload.password || ""), alias: String(payload.alias || ""), phone: String(payload.phone || ""),
        role: "administrador", canManageChargers: true,
      });
      const cookie = await createSession(account.accountId, request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
    }
    if (action === "register") {
      const count = await getDatabase().prepare("SELECT COUNT(*) AS total FROM accounts").first<{ total: number }>();
      if ((count?.total ?? 0) === 0) return Response.json({ error: "Primero debe crearse la cuenta administradora inicial." }, { status: 409 });
      // Public registration always creates the least-privileged account.
      // Role and charger-management permissions are assigned only by an admin.
      const account = await createLocalAccount({
        username: String(payload.username || ""), password: String(payload.password || ""), alias: String(payload.alias || ""), phone: String(payload.phone || ""),
        role: "usuario", canManageChargers: false,
      });
      const cookie = await createSession(account.accountId, request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
    }
    if (action === "login") {
      const accountId = await authenticate(String(payload.username || ""), String(payload.password || ""));
      const cookie = await createSession(accountId, request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
    }
    if (action === "logout") {
      const cookie = await revokeSession(request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
    }
    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) { return replyError(error); }
}
