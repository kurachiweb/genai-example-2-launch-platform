CREATE TABLE `guest_inquiries` (
	`id` text PRIMARY KEY,
	`category_id` text NOT NULL,
	`nickname` text NOT NULL,
	`email` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`status_changed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_guest_inquiries_category_id_inquiry_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `inquiry_categories`(`id`),
	CONSTRAINT "guest_inquiries_status_check" CHECK("status" in ('open', 'in_progress', 'resolved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE `inquiry_categories` (
	`id` text PRIMARY KEY,
	`name` text collate nocase NOT NULL UNIQUE,
	`system_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "inquiry_categories_system_default_check" CHECK("system_default" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `inquiry_message_attachments` (
	`message_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `inquiry_message_attachments_message_id_file_id_pk` PRIMARY KEY(`message_id`, `file_id`),
	CONSTRAINT `fk_inquiry_message_attachments_message_id_inquiry_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `inquiry_messages`(`id`)
);
--> statement-breakpoint
CREATE TABLE `inquiry_messages` (
	`id` text PRIMARY KEY,
	`inquiry_id` text NOT NULL,
	`sender_kind` text NOT NULL,
	`admin_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_inquiry_messages_inquiry_id_member_inquiries_id_fk` FOREIGN KEY (`inquiry_id`) REFERENCES `member_inquiries`(`id`),
	CONSTRAINT "inquiry_messages_sender_kind_check" CHECK("sender_kind" in ('user', 'admin')),
	CONSTRAINT "inquiry_messages_admin_id_check" CHECK(("sender_kind" = 'admin') = ("admin_id" is not null))
);
--> statement-breakpoint
CREATE TABLE `member_inquiries` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`status_changed_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_member_inquiries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_member_inquiries_category_id_inquiry_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `inquiry_categories`(`id`),
	CONSTRAINT "member_inquiries_status_check" CHECK("status" in ('open', 'in_progress', 'resolved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `guest_inquiries_status_created_at_idx` ON `guest_inquiries` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `guest_inquiries_status_status_changed_at_idx` ON `guest_inquiries` (`status`,`status_changed_at`);--> statement-breakpoint
CREATE INDEX `guest_inquiries_category_id_idx` ON `guest_inquiries` (`category_id`);--> statement-breakpoint
CREATE INDEX `guest_inquiries_created_at_idx` ON `guest_inquiries` (`created_at`);--> statement-breakpoint
CREATE INDEX `inquiry_message_attachments_file_id_idx` ON `inquiry_message_attachments` (`file_id`);--> statement-breakpoint
CREATE INDEX `inquiry_messages_inquiry_id_created_at_id_idx` ON `inquiry_messages` (`inquiry_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `member_inquiries_user_id_created_at_idx` ON `member_inquiries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `member_inquiries_status_created_at_idx` ON `member_inquiries` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `member_inquiries_category_id_idx` ON `member_inquiries` (`category_id`);--> statement-breakpoint
CREATE INDEX `member_inquiries_created_at_idx` ON `member_inquiries` (`created_at`);