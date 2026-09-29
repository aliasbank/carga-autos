import { getDatabase } from "@/lib/database";

const SESSION_COOKIE = "carga_session";
const SESSION_SECONDS = 60 * 60 * 8;
const encoder = new TextEncoder();

export type Role = "usuario" | "coordinador" | "administrador";
export type Principal = {
  accountId: number;
  profileId: number;
  username: string;
  role: Role;
  isActive: boolean;
  canManageChargers: boolean;
  notificationChannel: "app" | "email";
  vehicleMake: string;
  vehicleColor: string;
};

export class AuthError extends Error {
  constructor(message = "Inicia sesión para continuar.", public status = 401) { super(message); }
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function randomHex(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

async function digest(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(salt), iterations: 210_000 }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

export function validateCredentials(username: string, password: string) {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(normalized)) throw new AuthError("El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.", 400);
  if (password.length < 12) throw new AuthError("La contraseña debe tener al menos 12 caracteres.", 400);
  if (password.toLowerCase().includes(normalized)) throw new AuthError("La contraseña no puede incluir el usuario.", 400);
  return normalized;
}

function cookieValue(request: Request, name: string) {
  const item = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function sessionCookie(token: string, request: Request, expired = false) {
  // The application remains bound to loopback behind Nginx in production.
  // Trust the forwarded scheme there so session cookies stay HTTPS-only while
  // local HTTP development continues to work without a Secure cookie.
  const forwardedProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  const secure = forwardedProto === "https" || new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const expiry = expired ? "; Max-Age=0" : `; Max-Age=${SESSION_SECONDS}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure}${expiry}`;
}

export async function currentUser(request: Request): Promise<Principal | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const database = getDatabase();
  const result = await database.prepare(`
    SELECT a.id AS account_id, a.username, p.id AS profile_id, p.role, p.is_active,
      p.can_manage_chargers, p.notification_channel, p.vehicle_make, p.vehicle_color
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    JOIN profiles p ON p.id = a.profile_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await digest(token), new Date().toISOString()).first<Record<string, unknown>>();
  if (!result || Number(result.is_active) !== 1) return null;
  return {
    accountId: Number(result.account_id), profileId: Number(result.profile_id), username: String(result.username), role: result.role as Role,
    isActive: true, canManageChargers: Number(result.can_manage_chargers) === 1, notificationChannel: result.notification_channel as "app" | "email",
    vehicleMake: String(result.vehicle_make || ""), vehicleColor: String(result.vehicle_color || ""),
  };
}

export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new AuthError();
  return user;
}

export function canManageChargers(user: Principal) {
  return user.role === "administrador" || user.canManageChargers;
}

/** Coordinators can supervise queue incidents without gaining charger setup access. */
export function canSuperviseQueue(user: Principal) {
  return user.role === "coordinador" || user.role === "administrador";
}

export function isAdmin(user: Principal) { return user.role === "administrador"; }

export type NewAccount = {
  username: string;
  password: string;
  role: Role;
  canManageChargers?: boolean;
};

export async function createLocalAccount(input: NewAccount) {
  const username = validateCredentials(input.username, input.password);
  // These compatibility fields remain in the database for a future bot integration.
  // The username is now the sole visible identity in the application.
  const alias = username;
  const phone = "";
  const salt = randomHex(16);
  const database = getDatabase();
  const profileResult = await database.prepare(`
    INSERT INTO profiles (auth_user_id, alias, phone, role, is_active, can_manage_chargers, notification_channel)
    VALUES (?, ?, ?, ?, 1, ?, 'app')
  `).bind(`local:${username}`, alias, phone, input.role, input.role === "administrador" || input.canManageChargers ? 1 : 0).run();
  const profileId = Number(profileResult.meta.last_row_id);
  const accountResult = await database.prepare("INSERT INTO accounts (profile_id, username, password_hash, password_salt) VALUES (?, ?, ?, ?)")
    .bind(profileId, username, await passwordHash(input.password, salt), salt).run();
  return { profileId, accountId: Number(accountResult.meta.last_row_id), username };
}

export async function authenticate(usernameInput: string, password: string) {
  const username = usernameInput.trim().toLowerCase();
  const database = getDatabase();
  const row = await database.prepare(`
    SELECT a.id, a.password_hash, a.password_salt, a.failed_attempts, a.locked_until, p.is_active
    FROM accounts a JOIN profiles p ON p.id = a.profile_id WHERE a.username = ?
  `).bind(username).first<Record<string, unknown>>();
  const generic = new AuthError("Usuario o contraseña incorrectos.");
  if (!row || Number(row.is_active) !== 1) throw generic;
  if (row.locked_until && new Date(String(row.locked_until)).getTime() > Date.now()) throw new AuthError("La cuenta está bloqueada temporalmente. Intenta de nuevo más tarde.", 429);
  const valid = await passwordHash(password, String(row.password_salt)) === String(row.password_hash);
  if (!valid) {
    const attempts = Number(row.failed_attempts) + 1;
    const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await database.prepare("UPDATE accounts SET failed_attempts = ?, locked_until = ? WHERE id = ?").bind(attempts >= 5 ? 0 : attempts, lockedUntil, row.id).run();
    throw generic;
  }
  await database.prepare("UPDATE accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  return Number(row.id);
}

export async function resetPassword(profileId: number, password: string) {
  if (password.length < 12) throw new AuthError("La contraseña debe tener al menos 12 caracteres.", 400);
  const salt = randomHex(16);
  await getDatabase().prepare("UPDATE accounts SET password_hash = ?, password_salt = ?, failed_attempts = 0, locked_until = NULL WHERE profile_id = ?")
    .bind(await passwordHash(password, salt), salt, profileId).run();
}

export async function createSession(accountId: number, request: Request) {
  const token = randomHex();
  const expiry = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const database = getDatabase();
  await database.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
  await database.prepare("INSERT INTO sessions (account_id, token_hash, expires_at) VALUES (?, ?, ?)").bind(accountId, await digest(token), expiry).run();
  return sessionCookie(token, request);
}

export async function revokeSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(token)).run();
  return sessionCookie("", request, true);
}
