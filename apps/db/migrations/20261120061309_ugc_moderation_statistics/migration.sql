CREATE TABLE `moderation_weekly_statistics` (
	`id` text PRIMARY KEY,
	`week_start` text NOT NULL,
	`net_revenue` integer NOT NULL,
	`users_total` integer NOT NULL,
	`products_total` integer NOT NULL,
	`qualifier_matches` integer NOT NULL,
	`upvotes` integer NOT NULL,
	`finalized` integer NOT NULL,
	`computed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "moderation_weekly_statistics_finalized_check" CHECK("finalized" in (0, 1)),
	CONSTRAINT "moderation_weekly_statistics_users_total_check" CHECK("users_total" >= 0),
	CONSTRAINT "moderation_weekly_statistics_products_total_check" CHECK("products_total" >= 0),
	CONSTRAINT "moderation_weekly_statistics_qualifier_matches_check" CHECK("qualifier_matches" >= 0),
	CONSTRAINT "moderation_weekly_statistics_upvotes_check" CHECK("upvotes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderation_weekly_statistics_week_start_unique` ON `moderation_weekly_statistics` (`week_start`);