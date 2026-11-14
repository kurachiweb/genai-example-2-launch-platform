CREATE TABLE `help_article_previous_handles` (
	`id` text PRIMARY KEY,
	`article_id` text NOT NULL UNIQUE,
	`handle` text collate nocase NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_help_article_previous_handles_article_id_help_articles_id_fk` FOREIGN KEY (`article_id`) REFERENCES `help_articles`(`id`)
);
--> statement-breakpoint
CREATE TABLE `help_article_search_documents` (
	`id` integer PRIMARY KEY,
	`source_id` text NOT NULL UNIQUE,
	`source_version` integer DEFAULT 0 NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`keyword_status` text DEFAULT 'pending' NOT NULL,
	`extraction_input_hash` text,
	`status_changed_at` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `help_articles` (
	`id` text PRIMARY KEY,
	`handle` text collate nocase NOT NULL UNIQUE,
	`title` text NOT NULL,
	`subtitle` text NOT NULL,
	`body_markdown` text NOT NULL,
	`category_id` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_by_admin_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_help_articles_category_id_help_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `help_categories`(`id`),
	CONSTRAINT "help_articles_pinned_check" CHECK("pinned" in (0, 1)),
	CONSTRAINT "help_articles_status_check" CHECK("status" in ('draft', 'published')),
	CONSTRAINT "help_articles_sort_order_check" CHECK("sort_order" >= 1),
	CONSTRAINT "help_articles_revision_check" CHECK("revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE `help_categories` (
	`id` text PRIMARY KEY,
	`name` text collate nocase NOT NULL UNIQUE,
	`system_default` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "help_categories_system_default_check" CHECK("system_default" in (0, 1)),
	CONSTRAINT "help_categories_sort_order_check" CHECK("sort_order" >= 1)
);
--> statement-breakpoint
CREATE INDEX `help_article_search_documents_status_idx` ON `help_article_search_documents` (`keyword_status`,`status_changed_at`);--> statement-breakpoint
CREATE INDEX `help_articles_category_id_sort_order_idx` ON `help_articles` (`category_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `help_articles_status_category_id_idx` ON `help_articles` (`status`,`category_id`);--> statement-breakpoint
CREATE INDEX `help_categories_sort_order_idx` ON `help_categories` (`sort_order`);