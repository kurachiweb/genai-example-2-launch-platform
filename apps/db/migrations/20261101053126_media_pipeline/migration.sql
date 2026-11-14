CREATE TABLE `media_file_quarantine_reasons` (
	`id` text PRIMARY KEY,
	`file_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_media_file_quarantine_reasons_file_id_media_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `media_files`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` text PRIMARY KEY,
	`object_key` text NOT NULL UNIQUE,
	`purpose` text NOT NULL,
	`storage` text NOT NULL,
	`location` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text,
	`original_file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`stored_at` integer,
	`attached_at` integer,
	`moderation_status` text NOT NULL,
	`moderation_detail` text,
	`moderated_at` integer,
	`erase_requested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_file_quarantine_reasons_file_id_reason_unique` ON `media_file_quarantine_reasons` (`file_id`,`reason`);--> statement-breakpoint
CREATE INDEX `media_file_quarantine_reasons_reason_created_at_idx` ON `media_file_quarantine_reasons` (`reason`,`created_at`);--> statement-breakpoint
CREATE INDEX `media_files_owner_kind_owner_id_idx` ON `media_files` (`owner_kind`,`owner_id`);--> statement-breakpoint
CREATE INDEX `media_files_attached_at_created_at_idx` ON `media_files` (`attached_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `media_files_deleted_at_idx` ON `media_files` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `media_files_moderation_status_created_at_idx` ON `media_files` (`moderation_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `media_files_erase_requested_at_idx` ON `media_files` (`erase_requested_at`);--> statement-breakpoint
CREATE INDEX `media_files_storage_location_idx` ON `media_files` (`storage`,`location`);