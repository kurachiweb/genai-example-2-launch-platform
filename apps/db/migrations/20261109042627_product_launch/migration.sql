CREATE TABLE `product_categories` (
	`id` text PRIMARY KEY,
	`name` text collate nocase NOT NULL UNIQUE,
	`handle` text collate nocase NOT NULL UNIQUE,
	`system_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "product_categories_system_default_check" CHECK("system_default" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `product_launches` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`launch_date` text NOT NULL,
	`outcome` text,
	`decided_at` integer,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_product_launches_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT "product_launches_outcome_check" CHECK("outcome" in ('won', 'lost'))
);
--> statement-breakpoint
CREATE TABLE `product_lifecycle_events` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`dispatch_count` integer DEFAULT 1 NOT NULL,
	`last_dispatched_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_product_lifecycle_events_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT "product_lifecycle_events_type_check" CHECK("type" in ('deleted', 'hidden', 'unhidden', 'purge_due')),
	CONSTRAINT "product_lifecycle_events_status_check" CHECK("status" in ('pending', 'completed'))
);
--> statement-breakpoint
CREATE TABLE `product_lifecycle_handler_runs` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`handler_name` text NOT NULL,
	`completed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_product_lifecycle_handler_runs_event_id_product_lifecycle_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `product_lifecycle_events`(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_previous_handles` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL UNIQUE,
	`handle` text collate nocase NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_product_previous_handles_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_screenshots` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`position` integer NOT NULL,
	`file_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_product_screenshots_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT "product_screenshots_position_check" CHECK("position" between 0 and 19)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`handle` text collate nocase NOT NULL UNIQUE,
	`name` text NOT NULL,
	`tagline` text NOT NULL,
	`website_url` text NOT NULL,
	`description_markdown` text NOT NULL,
	`logo_file_id` text NOT NULL,
	`latest_launch_date` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`hidden_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_products_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_products_category_id_product_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_launches_product_id_open_unique` ON `product_launches` (`product_id`) WHERE ("product_launches"."outcome" is null and "product_launches"."cancelled_at" is null);--> statement-breakpoint
CREATE INDEX `product_launches_launch_date_id_idx` ON `product_launches` (`launch_date`,`id`);--> statement-breakpoint
CREATE INDEX `product_launches_product_id_launch_date_idx` ON `product_launches` (`product_id`,`launch_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_lifecycle_events_product_id_purge_due_unique` ON `product_lifecycle_events` (`product_id`) WHERE "product_lifecycle_events"."type" = 'purge_due';--> statement-breakpoint
CREATE INDEX `product_lifecycle_events_product_id_status_occurred_at_id_idx` ON `product_lifecycle_events` (`product_id`,`status`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `product_lifecycle_events_status_last_dispatched_at_idx` ON `product_lifecycle_events` (`status`,`last_dispatched_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_lifecycle_handler_runs_event_id_handler_name_unique` ON `product_lifecycle_handler_runs` (`event_id`,`handler_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_screenshots_product_id_position_unique` ON `product_screenshots` (`product_id`,`position`);--> statement-breakpoint
CREATE INDEX `products_user_id_latest_launch_date_id_idx` ON `products` (`user_id`,`latest_launch_date`,`id`);--> statement-breakpoint
CREATE INDEX `products_category_id_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_deleted_at_idx` ON `products` (`deleted_at`);