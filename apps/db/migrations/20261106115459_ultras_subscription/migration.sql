CREATE TABLE `ultras_activations` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`activated_at` integer NOT NULL,
	`dispatched_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_ultras_activations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `ultras_notices` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_ultras_notices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "ultras_notices_kind_check" CHECK("kind" in ('payment_failed', 'cancellation_accepted')),
	CONSTRAINT "ultras_notices_status_check" CHECK("status" in ('pending', 'requested', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `ultras_settings` (
	`id` text PRIMARY KEY,
	`setting_key` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_by_admin_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ultras_settings_enabled_check" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `ultras_subscriptions` (
	`id` text PRIMARY KEY,
	`stripe_subscription_id` text NOT NULL,
	`user_id` text NOT NULL,
	`purchase_id` text,
	`stripe_status` text NOT NULL,
	`cancel_scheduled` integer DEFAULT false NOT NULL,
	`cancel_at` integer,
	`current_period_end` integer,
	`ended_at` integer,
	`started_at` integer,
	`benefit_ends_at` integer,
	`benefit_end_fixed` integer DEFAULT false NOT NULL,
	`canceled_at` integer,
	`cancellation_source` text,
	`pending_cancellation_source` text,
	`past_due_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_ultras_subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "ultras_subscriptions_stripe_status_check" CHECK("stripe_status" in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
	CONSTRAINT "ultras_subscriptions_cancel_scheduled_check" CHECK("cancel_scheduled" in (0, 1)),
	CONSTRAINT "ultras_subscriptions_benefit_end_fixed_check" CHECK("benefit_end_fixed" in (0, 1)),
	CONSTRAINT "ultras_subscriptions_cancellation_source_check" CHECK("cancellation_source" in ('user', 'suspension', 'withdrawal')),
	CONSTRAINT "ultras_subscriptions_pending_cancellation_source_check" CHECK("pending_cancellation_source" in ('suspension', 'withdrawal'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ultras_activations_stripe_subscription_id_unique` ON `ultras_activations` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `ultras_activations_completed_at_dispatched_at_created_at_idx` ON `ultras_activations` (`completed_at`,`dispatched_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ultras_notices_dedupe_key_unique` ON `ultras_notices` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `ultras_notices_stripe_subscription_id_idx` ON `ultras_notices` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `ultras_notices_status_created_at_idx` ON `ultras_notices` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ultras_settings_setting_key_unique` ON `ultras_settings` (`setting_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ultras_subscriptions_stripe_subscription_id_unique` ON `ultras_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ultras_subscriptions_user_id_benefit_open_unique` ON `ultras_subscriptions` (`user_id`) WHERE "ultras_subscriptions"."started_at" is not null and "ultras_subscriptions"."benefit_ends_at" is null;--> statement-breakpoint
CREATE INDEX `ultras_subscriptions_user_id_started_at_idx` ON `ultras_subscriptions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ultras_subscriptions_stripe_status_idx` ON `ultras_subscriptions` (`stripe_status`);