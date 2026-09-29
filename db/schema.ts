import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  authUserId: text("auth_user_id").notNull().unique(),
  alias: text("alias").notNull().default(""),
  phone: text("phone").notNull().default(""),
  role: text("role", { enum: ["usuario", "coordinador", "administrador"] }).notNull().default("usuario"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  canManageChargers: integer("can_manage_chargers", { mode: "boolean" }).notNull().default(false),
  notificationChannel: text("notification_channel", { enum: ["app", "email"] }).notNull().default("app"),
  vehicleMake: text("vehicle_make"),
  vehicleColor: text("vehicle_color"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").notNull().unique().references(() => profiles.id),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_sessions_account_id").on(table.accountId),
  index("idx_sessions_expires_at").on(table.expiresAt),
]);

export const chargers = sqliteTable("chargers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  location: text("location").notNull(),
  accessLevel: text("access_level", { enum: ["colaborador", "coordinador"] }).notNull().default("colaborador"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const chargingQueue = sqliteTable("charging_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chargerId: integer("charger_id").notNull().references(() => chargers.id),
  profileId: integer("profile_id").notNull().references(() => profiles.id),
  scheduledStart: text("scheduled_start").notNull(),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  status: text("status", { enum: ["queued", "active", "completed", "cancelled"] }).notNull().default("queued"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_queue_charger_status_start").on(table.chargerId, table.status, table.scheduledStart),
  index("idx_queue_profile_status").on(table.profileId, table.status),
]);

export const chargerBlocks = sqliteTable("charger_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chargerId: integer("charger_id").notNull().references(() => chargers.id),
  affectedQueueId: integer("affected_queue_id").references(() => chargingQueue.id),
  reportedByProfileId: integer("reported_by_profile_id").notNull().references(() => profiles.id),
  reportedAt: text("reported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  releasedAt: text("released_at"),
  releasedByProfileId: integer("released_by_profile_id").references(() => profiles.id),
  status: text("status", { enum: ["open", "released"] }).notNull().default("open"),
}, (table) => [
  index("idx_charger_blocks_charger_status").on(table.chargerId, table.status),
  index("idx_charger_blocks_queue_status").on(table.affectedQueueId, table.status),
]);
