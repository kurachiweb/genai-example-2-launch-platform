CREATE TABLE `data_exports` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`run_token` text,
	`lease_expires_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`upload_id` text,
	`object_key` text,
	`file_name` text,
	`byte_size` integer,
	`completed_at` integer,
	`expires_at` integer,
	`failed_at` integer,
	`failure_kind` text,
	`notice_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_data_exports_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "data_exports_status_check" CHECK("status" in ('queued', 'generating', 'ready', 'expired', 'failed')),
	CONSTRAINT "data_exports_failure_kind_check" CHECK("failure_kind" in ('error', 'too_large')),
	CONSTRAINT "data_exports_notice_status_check" CHECK("notice_status" in ('none', 'pending', 'requested', 'skipped')),
	CONSTRAINT "data_exports_ready_check" CHECK(("status" <> 'ready' or ("object_key" is not null and "file_name" is not null and "byte_size" is not null and "completed_at" is not null and "expires_at" is not null and "upload_id" is null))),
	CONSTRAINT "data_exports_expired_check" CHECK(("status" <> 'expired' or ("file_name" is not null and "byte_size" is not null and "completed_at" is not null and "expires_at" is not null and "object_key" is null and "upload_id" is null))),
	CONSTRAINT "data_exports_failed_check" CHECK(("status" <> 'failed' or ("failed_at" is not null and "failure_kind" is not null)))
);
--> statement-breakpoint
CREATE INDEX `data_exports_user_id_requested_at_idx` ON `data_exports` (`user_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `data_exports_status_expires_at_idx` ON `data_exports` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `data_exports_status_upload_id_idx` ON `data_exports` (`status`,`upload_id`);--> statement-breakpoint
CREATE INDEX `data_exports_status_requested_at_idx` ON `data_exports` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `data_exports_notice_status_updated_at_idx` ON `data_exports` (`notice_status`,`updated_at`);