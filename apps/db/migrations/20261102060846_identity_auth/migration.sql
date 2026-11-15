CREATE TABLE `user_auth_tokens` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`expires_at` integer NOT NULL,
	`new_email` text collate nocase,
	`pending_password_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_auth_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "user_auth_tokens_purpose_check" CHECK("purpose" in ('email_verification', 'email_change', 'password_reset', 'password_change'))
);
--> statement-breakpoint
CREATE TABLE `user_lifecycle_events` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_at` integer,
	`dispatch_count` integer DEFAULT 1 NOT NULL,
	`last_dispatched_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "user_lifecycle_events_type_check" CHECK("type" in ('withdrawn', 'suspended', 'unsuspended', 'purge_due')),
	CONSTRAINT "user_lifecycle_events_status_check" CHECK("status" in ('pending', 'completed'))
);
--> statement-breakpoint
CREATE TABLE `user_lifecycle_handler_runs` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`handler_name` text NOT NULL,
	`completed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_lifecycle_handler_runs_event_id_user_lifecycle_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `user_lifecycle_events`(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_login_challenges` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_login_challenges_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_recovery_codes` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_recovery_codes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`user_agent` text,
	`last_used_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_totp_credentials` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL UNIQUE,
	`sealed_secret` text NOT NULL,
	`enabled_at` integer,
	`pending_expires_at` integer,
	`last_used_step` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_totp_credentials_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`pseudonymous_id` text NOT NULL UNIQUE,
	`email` text collate nocase NOT NULL,
	`password_hash` text NOT NULL,
	`nickname` text NOT NULL,
	`handle` text collate nocase NOT NULL UNIQUE,
	`status` text DEFAULT 'active' NOT NULL,
	`suspended_at` integer,
	`email_verified_at` integer,
	`disposable_email_status` text,
	`disposable_email_checked_at` integer,
	`terms_agreed_at` integer NOT NULL,
	`lifecycle_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "users_status_check" CHECK("status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE INDEX `user_auth_tokens_user_id_purpose_idx` ON `user_auth_tokens` (`user_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `user_auth_tokens_expires_at_idx` ON `user_auth_tokens` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_lifecycle_events_user_id_purge_due_unique` ON `user_lifecycle_events` (`user_id`) WHERE "user_lifecycle_events"."type" = 'purge_due';--> statement-breakpoint
CREATE INDEX `user_lifecycle_events_user_id_status_occurred_at_idx` ON `user_lifecycle_events` (`user_id`,`status`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `user_lifecycle_events_status_last_dispatched_at_idx` ON `user_lifecycle_events` (`status`,`last_dispatched_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_lifecycle_handler_runs_event_id_handler_name_unique` ON `user_lifecycle_handler_runs` (`event_id`,`handler_name`);--> statement-breakpoint
CREATE INDEX `user_login_challenges_expires_at_idx` ON `user_login_challenges` (`expires_at`);--> statement-breakpoint
CREATE INDEX `user_recovery_codes_user_id_idx` ON `user_recovery_codes` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_sessions_user_id_idx` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_sessions_last_used_at_idx` ON `user_sessions` (`last_used_at`);--> statement-breakpoint
CREATE INDEX `user_sessions_absolute_expires_at_idx` ON `user_sessions` (`absolute_expires_at`);--> statement-breakpoint
CREATE INDEX `user_totp_credentials_pending_expires_at_idx` ON `user_totp_credentials` (`pending_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_not_deleted_unique` ON `users` (`email`) WHERE ("users"."deleted_at" is null);--> statement-breakpoint
CREATE INDEX `users_deleted_at_idx` ON `users` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `users_status_deleted_at_idx` ON `users` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `users_disposable_email_status_checked_at_idx` ON `users` (`disposable_email_status`,`disposable_email_checked_at`);