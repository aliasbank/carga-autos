CREATE TABLE `chargers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`location` text NOT NULL,
	`access_level` text DEFAULT 'colaborador' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chargers_code_unique` ON `chargers` (`code`);--> statement-breakpoint
CREATE TABLE `charging_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`charger_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`scheduled_start` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`duration_minutes` integer DEFAULT 120 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`charger_id`) REFERENCES `chargers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`auth_user_id` text NOT NULL,
	`alias` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'colaborador' NOT NULL,
	`notification_channel` text DEFAULT 'app' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_auth_user_id_unique` ON `profiles` (`auth_user_id`);