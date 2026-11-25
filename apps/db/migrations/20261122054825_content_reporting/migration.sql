CREATE TABLE `report_cases` (
	`id` text PRIMARY KEY,
	`target_kind` text NOT NULL,
	`target_id` text,
	`target_owner_user_id` text,
	`product_id` text,
	`target_detached_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`status_changed_at` integer NOT NULL,
	`last_reported_at` integer NOT NULL,
	`infringement_reported_at` integer,
	`closed_at` integer,
	`resolution` text,
	`resolution_action_id` text,
	`closing_reason` text,
	`poster_notice_status` text DEFAULT 'none' NOT NULL,
	`poster_notice_requested_at` integer,
	`last_inquired_at` integer,
	`last_inquiry_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "report_cases_target_kind_check" CHECK("target_kind" in ('user', 'product', 'comment')),
	CONSTRAINT "report_cases_status_check" CHECK("status" in ('open', 'in_progress', 'resolved', 'rejected')),
	CONSTRAINT "report_cases_resolution_check" CHECK("resolution" in ('product.hide', 'comment.hide', 'user.suspend', 'none')),
	CONSTRAINT "report_cases_poster_notice_status_check" CHECK("poster_notice_status" in ('none', 'pending', 'requested', 'skipped')),
	CONSTRAINT "report_cases_closed_at_check" CHECK(("status" in ('resolved', 'rejected')) = ("closed_at" is not null)),
	CONSTRAINT "report_cases_target_detached_at_check" CHECK(("target_id" is null) = ("target_detached_at" is not null)),
	CONSTRAINT "report_cases_resolution_action_id_check" CHECK(("resolution_action_id" is null or ("status" = 'resolved' and "resolution" in ('product.hide', 'comment.hide', 'user.suspend'))))
);
--> statement-breakpoint
CREATE TABLE `report_categories` (
	`id` text PRIMARY KEY,
	`name` text collate nocase NOT NULL UNIQUE,
	`system_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "report_categories_system_default_check" CHECK("system_default" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY,
	`case_id` text NOT NULL,
	`reporter_user_id` text,
	`contact_email` text,
	`category_id` text NOT NULL,
	`category_name` text NOT NULL,
	`reason` text NOT NULL,
	`reported_at` integer NOT NULL,
	`outcome_notice_status` text DEFAULT 'none' NOT NULL,
	`outcome_notice_requested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_reports_case_id_report_cases_id_fk` FOREIGN KEY (`case_id`) REFERENCES `report_cases`(`id`),
	CONSTRAINT `fk_reports_reporter_user_id_users_id_fk` FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_reports_category_id_report_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `report_categories`(`id`),
	CONSTRAINT "reports_outcome_notice_status_check" CHECK("outcome_notice_status" in ('none', 'pending', 'requested', 'skipped')),
	CONSTRAINT "reports_contact_email_check" CHECK(not ("reporter_user_id" is not null and "contact_email" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_cases_target_kind_target_id_open_unique` ON `report_cases` (`target_kind`,`target_id`) WHERE "report_cases"."closed_at" is null;--> statement-breakpoint
CREATE INDEX `report_cases_last_reported_at_id_idx` ON `report_cases` (`last_reported_at`,`id`);--> statement-breakpoint
CREATE INDEX `report_cases_status_last_reported_at_idx` ON `report_cases` (`status`,`last_reported_at`);--> statement-breakpoint
CREATE INDEX `report_cases_target_owner_user_id_idx` ON `report_cases` (`target_owner_user_id`);--> statement-breakpoint
CREATE INDEX `report_cases_product_id_idx` ON `report_cases` (`product_id`);--> statement-breakpoint
CREATE INDEX `report_cases_closed_at_idx` ON `report_cases` (`closed_at`);--> statement-breakpoint
CREATE INDEX `report_cases_target_detached_at_idx` ON `report_cases` (`target_detached_at`);--> statement-breakpoint
CREATE INDEX `reports_case_id_reported_at_idx` ON `reports` (`case_id`,`reported_at`);--> statement-breakpoint
CREATE INDEX `reports_reporter_user_id_idx` ON `reports` (`reporter_user_id`);--> statement-breakpoint
CREATE INDEX `reports_category_id_idx` ON `reports` (`category_id`);--> statement-breakpoint
CREATE INDEX `reports_outcome_notice_status_case_id_idx` ON `reports` (`outcome_notice_status`,`case_id`);