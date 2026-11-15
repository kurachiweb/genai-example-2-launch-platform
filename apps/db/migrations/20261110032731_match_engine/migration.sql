CREATE TABLE `match_entries` (
	`id` text PRIMARY KEY,
	`match_id` text NOT NULL,
	`slot` integer NOT NULL,
	`match_kind` text NOT NULL,
	`match_date` text NOT NULL,
	`launch_id` text,
	`product_id` text,
	`owner_user_id` text,
	`upvote_count` integer DEFAULT 0 NOT NULL,
	`last_upvoted_at` integer,
	`last_upvote_seq` integer,
	`forfeited_at` integer,
	`result` text,
	`unlinked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_match_entries_match_id_matches_id_fk` FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`),
	CONSTRAINT `fk_match_entries_launch_id_product_launches_id_fk` FOREIGN KEY (`launch_id`) REFERENCES `product_launches`(`id`),
	CONSTRAINT `fk_match_entries_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT "match_entries_slot_check" CHECK("slot" in (1, 2)),
	CONSTRAINT "match_entries_match_kind_check" CHECK("match_kind" in ('qualifier', 'week', 'year')),
	CONSTRAINT "match_entries_result_check" CHECK("result" in ('won', 'lost', 'bye', 'walkover'))
);
--> statement-breakpoint
CREATE TABLE `match_event_handler_runs` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`handler_name` text NOT NULL,
	`completed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_match_event_handler_runs_event_id_match_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `match_events`(`id`)
);
--> statement-breakpoint
CREATE TABLE `match_events` (
	`id` text PRIMARY KEY,
	`match_id` text NOT NULL,
	`match_kind` text NOT NULL,
	`type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`dispatch_count` integer DEFAULT 1 NOT NULL,
	`last_dispatched_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_match_events_match_id_matches_id_fk` FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`),
	CONSTRAINT "match_events_match_kind_check" CHECK("match_kind" in ('qualifier', 'week', 'year')),
	CONSTRAINT "match_events_type_check" CHECK("type" in ('scheduled', 'started', 'decided')),
	CONSTRAINT "match_events_status_check" CHECK("status" in ('pending', 'completed'))
);
--> statement-breakpoint
CREATE TABLE `match_upvotes` (
	`id` text PRIMARY KEY,
	`match_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`match_date` text NOT NULL,
	`upvoted_at` integer NOT NULL,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_match_upvotes_match_id_matches_id_fk` FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`),
	CONSTRAINT `fk_match_upvotes_entry_id_match_entries_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `match_entries`(`id`),
	CONSTRAINT `fk_match_upvotes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`match_date` text NOT NULL,
	`round` integer,
	`stage` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`started_at` integer,
	`decided_at` integer,
	`decision` text,
	`ended_early_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "matches_kind_check" CHECK("kind" in ('qualifier', 'week', 'year')),
	CONSTRAINT "matches_stage_check" CHECK("stage" in ('quarterfinal', 'semifinal', 'final')),
	CONSTRAINT "matches_decision_check" CHECK("decision" in ('votes', 'last_upvote', 'no_votes', 'bye', 'walkover', 'both_forfeited')),
	CONSTRAINT "matches_starts_before_ends_check" CHECK("starts_at" < "ends_at")
);
--> statement-breakpoint
CREATE TABLE `qualifier_pairings` (
	`id` text PRIMARY KEY,
	`match_date` text NOT NULL UNIQUE,
	`status` text DEFAULT 'pending' NOT NULL,
	`launch_count` integer,
	`match_count` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "qualifier_pairings_status_check" CHECK("status" in ('pending', 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_entries_match_id_slot_unique` ON `match_entries` (`match_id`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_entries_qualifier_launch_id_unique` ON `match_entries` (`launch_id`) WHERE ("match_entries"."match_kind" = 'qualifier' and "match_entries"."launch_id" is not null);--> statement-breakpoint
CREATE INDEX `match_entries_product_id_idx` ON `match_entries` (`product_id`);--> statement-breakpoint
CREATE INDEX `match_entries_owner_user_id_idx` ON `match_entries` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `match_entries_launch_id_idx` ON `match_entries` (`launch_id`);--> statement-breakpoint
CREATE INDEX `match_entries_match_kind_match_date_idx` ON `match_entries` (`match_kind`,`match_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_event_handler_runs_event_id_handler_name_unique` ON `match_event_handler_runs` (`event_id`,`handler_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_events_match_id_type_unique` ON `match_events` (`match_id`,`type`);--> statement-breakpoint
CREATE INDEX `match_events_match_id_status_occurred_at_id_idx` ON `match_events` (`match_id`,`status`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `match_events_status_last_dispatched_at_idx` ON `match_events` (`status`,`last_dispatched_at`);--> statement-breakpoint
CREATE INDEX `match_events_status_completed_at_idx` ON `match_events` (`status`,`completed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_upvotes_match_id_user_id_active_unique` ON `match_upvotes` (`match_id`,`user_id`) WHERE "match_upvotes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `match_upvotes_entry_id_deleted_at_upvoted_at_seq_idx` ON `match_upvotes` (`entry_id`,`deleted_at`,`upvoted_at`,`seq`);--> statement-breakpoint
CREATE INDEX `match_upvotes_user_id_deleted_at_match_date_upvoted_at_id_idx` ON `match_upvotes` (`user_id`,`deleted_at`,`match_date`,`upvoted_at`,`id`);--> statement-breakpoint
CREATE INDEX `match_upvotes_match_id_seq_idx` ON `match_upvotes` (`match_id`,`seq`);--> statement-breakpoint
CREATE INDEX `matches_match_date_kind_idx` ON `matches` (`match_date`,`kind`);--> statement-breakpoint
CREATE INDEX `matches_started_at_starts_at_idx` ON `matches` (`started_at`,`starts_at`);--> statement-breakpoint
CREATE INDEX `matches_decided_at_ends_at_idx` ON `matches` (`decided_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `matches_decided_at_idx` ON `matches` (`decided_at`);