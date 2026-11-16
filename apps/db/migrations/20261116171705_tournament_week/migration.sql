CREATE TABLE `bracket_matches` (
	`match_id` text PRIMARY KEY,
	`bracket_id` text NOT NULL,
	`round` integer NOT NULL,
	`position` integer NOT NULL,
	`match_date` text NOT NULL,
	`participant1_no` integer NOT NULL,
	`participant2_no` integer,
	`status` text NOT NULL,
	`winner_participant_no` integer,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_bracket_matches_bracket_id_tournament_brackets_id_fk` FOREIGN KEY (`bracket_id`) REFERENCES `tournament_brackets`(`id`),
	CONSTRAINT "bracket_matches_status_check" CHECK("status" in ('planned', 'scheduled', 'decided'))
);
--> statement-breakpoint
CREATE TABLE `bracket_participants` (
	`id` text PRIMARY KEY,
	`bracket_id` text NOT NULL,
	`participant_no` integer NOT NULL,
	`entry_ref` text NOT NULL,
	`launch_id` text,
	`product_id` text,
	`owner_user_id` text,
	`eliminated_round` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_bracket_participants_bracket_id_tournament_brackets_id_fk` FOREIGN KEY (`bracket_id`) REFERENCES `tournament_brackets`(`id`),
	CONSTRAINT `fk_bracket_participants_launch_id_product_launches_id_fk` FOREIGN KEY (`launch_id`) REFERENCES `product_launches`(`id`),
	CONSTRAINT `fk_bracket_participants_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_bracket_participants_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `tournament_brackets` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`tournament_id` text NOT NULL,
	`participant_count` integer NOT NULL,
	`seed_count` integer NOT NULL,
	`second_round_size` integer NOT NULL,
	`round_count` integer NOT NULL,
	`first_round_date` text,
	`status` text NOT NULL,
	`outcome` text,
	`champion_participant_no` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "tournament_brackets_kind_check" CHECK("kind" in ('week', 'year')),
	CONSTRAINT "tournament_brackets_status_check" CHECK("status" in ('active', 'finished')),
	CONSTRAINT "tournament_brackets_outcome_check" CHECK("outcome" in ('champion', 'no_award')),
	CONSTRAINT "tournament_brackets_finished_outcome_check" CHECK(("status" <> 'finished' or "outcome" is not null)),
	CONSTRAINT "tournament_brackets_champion_participant_check" CHECK(("outcome" is null or "outcome" <> 'champion' or "champion_participant_no" is not null))
);
--> statement-breakpoint
CREATE TABLE `week_tournament_entries` (
	`id` text PRIMARY KEY,
	`tournament_id` text NOT NULL,
	`launch_id` text,
	`product_id` text,
	`owner_user_id` text,
	`launch_date` text NOT NULL,
	`qualifier_match_id` text NOT NULL,
	`qualifier_upvote_count` integer NOT NULL,
	`qualifier_last_upvote_elapsed_ms` integer,
	`won_at` integer NOT NULL,
	`status` text NOT NULL,
	`entitlement_source` text,
	`purchase_id` text,
	`entitled_at` integer,
	`closed_at` integer,
	`close_reason` text,
	`refund_status` text DEFAULT 'none' NOT NULL,
	`refund_requested_at` integer,
	`refund_notice_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_week_tournament_entries_tournament_id_week_tournaments_id_fk` FOREIGN KEY (`tournament_id`) REFERENCES `week_tournaments`(`id`),
	CONSTRAINT `fk_week_tournament_entries_launch_id_product_launches_id_fk` FOREIGN KEY (`launch_id`) REFERENCES `product_launches`(`id`),
	CONSTRAINT `fk_week_tournament_entries_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_week_tournament_entries_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "week_tournament_entries_status_check" CHECK("status" in ('awaiting_payment', 'entitled', 'drawn', 'expired', 'forfeited', 'excluded')),
	CONSTRAINT "week_tournament_entries_entitlement_source_check" CHECK("entitlement_source" in ('payment', 'ultras')),
	CONSTRAINT "week_tournament_entries_close_reason_check" CHECK("close_reason" in ('deadline', 'deleted', 'withdrawn', 'hidden_or_suspended', 'late_entry')),
	CONSTRAINT "week_tournament_entries_refund_status_check" CHECK("refund_status" in ('none', 'pending', 'requested', 'not_needed', 'already_refunded', 'rejected')),
	CONSTRAINT "week_tournament_entries_refund_notice_status_check" CHECK("refund_notice_status" in ('none', 'pending', 'sent', 'skipped')),
	CONSTRAINT "week_tournament_entries_entitled_source_check" CHECK(("status" not in ('entitled', 'drawn') or "entitlement_source" is not null)),
	CONSTRAINT "week_tournament_entries_payment_purchase_check" CHECK(("entitlement_source" is null or "entitlement_source" <> 'payment' or "purchase_id" is not null))
);
--> statement-breakpoint
CREATE TABLE `week_tournaments` (
	`id` text PRIMARY KEY,
	`week_start` text NOT NULL,
	`accept_until` integer NOT NULL,
	`deadline_at` integer NOT NULL,
	`draw_at` integer NOT NULL,
	`status` text NOT NULL,
	`draw_started_at` integer,
	`drawn_at` integer,
	`bracket_id` text,
	`outcome` text,
	`champion_entry_id` text,
	`awarded_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_week_tournaments_bracket_id_tournament_brackets_id_fk` FOREIGN KEY (`bracket_id`) REFERENCES `tournament_brackets`(`id`),
	CONSTRAINT "week_tournaments_status_check" CHECK("status" in ('open', 'drawing', 'in_progress', 'finished')),
	CONSTRAINT "week_tournaments_outcome_check" CHECK("outcome" in ('awarded', 'no_award'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bracket_matches_bracket_id_round_position_unique` ON `bracket_matches` (`bracket_id`,`round`,`position`);--> statement-breakpoint
CREATE INDEX `bracket_matches_bracket_id_status_idx` ON `bracket_matches` (`bracket_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `bracket_participants_bracket_id_participant_no_unique` ON `bracket_participants` (`bracket_id`,`participant_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `bracket_participants_bracket_id_entry_ref_unique` ON `bracket_participants` (`bracket_id`,`entry_ref`);--> statement-breakpoint
CREATE INDEX `bracket_participants_product_id_idx` ON `bracket_participants` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_brackets_kind_tournament_id_unique` ON `tournament_brackets` (`kind`,`tournament_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `week_tournament_entries_launch_id_unique` ON `week_tournament_entries` (`launch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `week_tournament_entries_tournament_id_product_id_unique` ON `week_tournament_entries` (`tournament_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `week_tournament_entries_owner_user_id_status_idx` ON `week_tournament_entries` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `week_tournament_entries_tournament_id_status_idx` ON `week_tournament_entries` (`tournament_id`,`status`);--> statement-breakpoint
CREATE INDEX `week_tournament_entries_refund_status_updated_at_idx` ON `week_tournament_entries` (`refund_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `week_tournament_entries_refund_notice_status_updated_at_idx` ON `week_tournament_entries` (`refund_notice_status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `week_tournaments_week_start_unique` ON `week_tournaments` (`week_start`);--> statement-breakpoint
CREATE INDEX `week_tournaments_status_draw_at_idx` ON `week_tournaments` (`status`,`draw_at`);