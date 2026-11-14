CREATE TABLE `email_cleanup_cursors` (
	`id` text PRIMARY KEY,
	`name` text collate nocase NOT NULL UNIQUE,
	`after_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
