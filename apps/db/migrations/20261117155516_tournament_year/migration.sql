CREATE TABLE `year_tournament_entries` (
	`id` text PRIMARY KEY,
	`week_tournament_id` text NOT NULL,
	`week_period` text NOT NULL,
	`launch_id` text,
	`product_id` text,
	`owner_user_id` text,
	`launch_date` text NOT NULL,
	`qualifier_match_id` text NOT NULL,
	`qualifier_upvote_count` integer NOT NULL,
	`qualifier_last_upvote_elapsed_ms` integer,
	`awarded_at` integer NOT NULL,
	`awarded_date` text NOT NULL,
	`status` text NOT NULL,
	`entitlement_source` text,
	`purchase_id` text,
	`entitled_at` integer,
	`closed_at` integer,
	`close_reason` text,
	`classified_year` integer,
	`refund_status` text DEFAULT 'none' NOT NULL,
	`refund_requested_at` integer,
	`refund_notice_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_year_tournament_entries_launch_id_product_launches_id_fk` FOREIGN KEY (`launch_id`) REFERENCES `product_launches`(`id`),
	CONSTRAINT `fk_year_tournament_entries_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_year_tournament_entries_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "year_tournament_entries_status_check" CHECK("status" in ('awaiting_payment', 'entitled', 'drawn', 'expired', 'forfeited', 'excluded')),
	CONSTRAINT "year_tournament_entries_entitlement_source_check" CHECK("entitlement_source" in ('payment', 'ultras')),
	CONSTRAINT "year_tournament_entries_close_reason_check" CHECK("close_reason" in ('deadline', 'deleted', 'withdrawn', 'hidden_or_suspended', 'over_capacity', 'late_entry')),
	CONSTRAINT "year_tournament_entries_refund_status_check" CHECK("refund_status" in ('none', 'pending', 'requested', 'not_needed', 'already_refunded', 'rejected')),
	CONSTRAINT "year_tournament_entries_refund_notice_status_check" CHECK("refund_notice_status" in ('none', 'pending', 'sent', 'skipped')),
	CONSTRAINT "year_tournament_entries_entitled_source_check" CHECK(("status" not in ('entitled', 'drawn') or "entitlement_source" is not null)),
	CONSTRAINT "year_tournament_entries_payment_purchase_check" CHECK(("entitlement_source" is null or "entitlement_source" <> 'payment' or "purchase_id" is not null)),
	CONSTRAINT "year_tournament_entries_classified_year_check" CHECK(("classified_year" is not null or ("status" not in ('drawn', 'excluded') and ("close_reason" is null or "close_reason" <> 'late_entry'))))
);
--> statement-breakpoint
CREATE TABLE `year_tournaments` (
	`id` text PRIMARY KEY,
	`year` integer NOT NULL,
	`final_date` text NOT NULL,
	`final_date_source` text NOT NULL,
	`final_date_version` integer DEFAULT 0 NOT NULL,
	`final_date_updated_at` integer,
	`final_date_updated_by_admin_id` text,
	`deadline_date` text NOT NULL,
	`accept_until` integer NOT NULL,
	`deadline_at` integer NOT NULL,
	`draw_at` integer NOT NULL,
	`change_lock_at` integer NOT NULL,
	`status` text NOT NULL,
	`draw_started_at` integer,
	`drawn_at` integer,
	`bracket_id` text,
	`first_round_date` text,
	`participant_count` integer,
	`outcome` text,
	`champion_entry_id` text,
	`awarded_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_year_tournaments_bracket_id_tournament_brackets_id_fk` FOREIGN KEY (`bracket_id`) REFERENCES `tournament_brackets`(`id`),
	CONSTRAINT "year_tournaments_year_range_check" CHECK("year" between 1000 and 9999),
	CONSTRAINT "year_tournaments_final_date_source_check" CHECK("final_date_source" in ('explicit', 'default')),
	CONSTRAINT "year_tournaments_final_date_version_check" CHECK("final_date_version" >= 0),
	CONSTRAINT "year_tournaments_status_check" CHECK("status" in ('open', 'drawing', 'in_progress', 'finished')),
	CONSTRAINT "year_tournaments_outcome_check" CHECK("outcome" in ('awarded', 'no_award')),
	CONSTRAINT "year_tournaments_explicit_version_check" CHECK(("final_date_source" <> 'explicit' or "final_date_version" >= 1)),
	CONSTRAINT "year_tournaments_finished_outcome_check" CHECK(("status" <> 'finished' or "outcome" is not null)),
	CONSTRAINT "year_tournaments_awarded_champion_check" CHECK(("outcome" is null or "outcome" <> 'awarded' or "champion_entry_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `year_tournament_entries_week_tournament_id_unique` ON `year_tournament_entries` (`week_tournament_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `year_tournament_entries_launch_id_unique` ON `year_tournament_entries` (`launch_id`);--> statement-breakpoint
CREATE INDEX `year_tournament_entries_status_awarded_date_idx` ON `year_tournament_entries` (`status`,`awarded_date`);--> statement-breakpoint
CREATE INDEX `year_tournament_entries_owner_user_id_status_idx` ON `year_tournament_entries` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `year_tournament_entries_product_id_idx` ON `year_tournament_entries` (`product_id`);--> statement-breakpoint
CREATE INDEX `year_tournament_entries_classified_year_status_idx` ON `year_tournament_entries` (`classified_year`,`status`);--> statement-breakpoint
CREATE INDEX `year_tournament_entries_refund_status_updated_at_idx` ON `year_tournament_entries` (`refund_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `year_tournament_entries_refund_notice_status_updated_at_idx` ON `year_tournament_entries` (`refund_notice_status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `year_tournaments_year_unique` ON `year_tournaments` (`year`);--> statement-breakpoint
CREATE INDEX `year_tournaments_status_draw_at_idx` ON `year_tournaments` (`status`,`draw_at`);--> statement-breakpoint
CREATE INDEX `year_tournaments_draw_started_at_deadline_date_idx` ON `year_tournaments` (`draw_started_at`,`deadline_date`);