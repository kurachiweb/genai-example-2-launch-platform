CREATE TABLE `sponsorship_display_stops` (
	`id` text PRIMARY KEY,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "sponsorship_display_stops_subject_kind_check" CHECK("subject_kind" in ('product', 'user'))
);
--> statement-breakpoint
CREATE TABLE `sponsorships` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`tier` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`days` integer NOT NULL,
	`state` text NOT NULL,
	`purchase_id` text,
	`payment_record_id` text,
	`amount_total` integer,
	`paid_at` integer,
	`terminated_at` integer,
	`termination_reason` text,
	`start_notice` text DEFAULT 'none' NOT NULL,
	`end_notice` text DEFAULT 'none' NOT NULL,
	`termination_notice` text DEFAULT 'none' NOT NULL,
	`product_deleted_at` integer,
	`termination_refund_status` text DEFAULT 'none' NOT NULL,
	`termination_refund_days` integer,
	`termination_refund_amount` integer,
	`termination_refund_request_id` text,
	`stop_refund_status` text DEFAULT 'none' NOT NULL,
	`stop_refund_days` integer,
	`stop_refund_amount` integer,
	`stop_refund_request_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_sponsorships_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_sponsorships_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT "sponsorships_tier_check" CHECK("tier" in ('legend', 'gold', 'silver')),
	CONSTRAINT "sponsorships_state_check" CHECK("state" in ('pending_payment', 'paid', 'terminated')),
	CONSTRAINT "sponsorships_start_notice_check" CHECK("start_notice" in ('none', 'pending', 'requested', 'skipped')),
	CONSTRAINT "sponsorships_end_notice_check" CHECK("end_notice" in ('none', 'pending', 'requested', 'skipped')),
	CONSTRAINT "sponsorships_termination_notice_check" CHECK("termination_notice" in ('none', 'pending', 'requested', 'skipped')),
	CONSTRAINT "sponsorships_termination_refund_status_check" CHECK("termination_refund_status" in ('none', 'requested', 'not_needed', 'already_refunded', 'rejected')),
	CONSTRAINT "sponsorships_stop_refund_status_check" CHECK("stop_refund_status" in ('none', 'requested', 'not_needed', 'already_refunded', 'rejected')),
	CONSTRAINT "sponsorships_days_range_check" CHECK("days" between 1 and 366),
	CONSTRAINT "sponsorships_paid_columns_check" CHECK(("state" not in ('paid', 'terminated') or ("purchase_id" is not null and "payment_record_id" is not null and "amount_total" is not null and "paid_at" is not null))),
	CONSTRAINT "sponsorships_terminated_columns_check" CHECK(("state" <> 'terminated' or ("terminated_at" is not null and "termination_reason" is not null)))
);
--> statement-breakpoint
CREATE INDEX `sponsorship_display_stops_subject_idx` ON `sponsorship_display_stops` (`subject_kind`,`subject_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `sponsorships_display_idx` ON `sponsorships` (`state`,`starts_on`,`ends_on`);--> statement-breakpoint
CREATE INDEX `sponsorships_user_idx` ON `sponsorships` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sponsorships_product_tier_idx` ON `sponsorships` (`product_id`,`tier`,`state`);--> statement-breakpoint
CREATE INDEX `sponsorships_created_idx` ON `sponsorships` (`created_at`);--> statement-breakpoint
CREATE INDEX `sponsorships_unsettled_end_idx` ON `sponsorships` (`ends_on`) WHERE ("sponsorships"."state" = 'paid' and "sponsorships"."deleted_at" is null and ("sponsorships"."stop_refund_status" = 'none' or "sponsorships"."end_notice" = 'none'));--> statement-breakpoint
CREATE INDEX `sponsorships_pending_notice_idx` ON `sponsorships` (`updated_at`) WHERE ("sponsorships"."start_notice" = 'pending' or "sponsorships"."end_notice" = 'pending' or "sponsorships"."termination_notice" = 'pending');