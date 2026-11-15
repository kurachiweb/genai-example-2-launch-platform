CREATE TABLE `directory_entries` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL UNIQUE,
	`owner_user_id` text NOT NULL,
	`first_won_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_directory_entries_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_search_documents` (
	`id` integer PRIMARY KEY,
	`source_id` text NOT NULL UNIQUE,
	`source_version` integer DEFAULT 0 NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`keyword_status` text DEFAULT 'pending' NOT NULL,
	`extraction_input_hash` text,
	`status_changed_at` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`tagline` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `directory_entries_owner_user_id_idx` ON `directory_entries` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `product_search_documents_status_idx` ON `product_search_documents` (`keyword_status`,`status_changed_at`);