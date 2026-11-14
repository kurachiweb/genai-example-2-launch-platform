CREATE TABLE `email_alert_throttles` (
	`id` text PRIMARY KEY,
	`name` text collate nocase NOT NULL UNIQUE,
	`last_reported_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_send_records` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`sent_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`id` text PRIMARY KEY,
	`address` text collate nocase NOT NULL UNIQUE,
	`last_reason` text NOT NULL,
	`last_event_at` integer NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_send_records_sent_at_idx` ON `email_send_records` (`sent_at`);--> statement-breakpoint
CREATE INDEX `email_suppressions_last_event_at_idx` ON `email_suppressions` (`last_event_at`);--> statement-breakpoint
CREATE INDEX `email_suppressions_expires_at_idx` ON `email_suppressions` (`expires_at`);