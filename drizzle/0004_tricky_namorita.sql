CREATE TABLE `charger_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`charger_id` integer NOT NULL,
	`affected_queue_id` integer,
	`reported_by_profile_id` integer NOT NULL,
	`reported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`released_at` text,
	`released_by_profile_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`charger_id`) REFERENCES `chargers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`affected_queue_id`) REFERENCES `charging_queue`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_charger_blocks_charger_status` ON `charger_blocks` (`charger_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_charger_blocks_queue_status` ON `charger_blocks` (`affected_queue_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `charger_blocks_one_open_per_charger` ON `charger_blocks` (`charger_id`) WHERE `status` = 'open';
