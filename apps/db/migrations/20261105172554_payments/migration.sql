CREATE TABLE `payment_customers` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_payment_customers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_price_snapshots` (
	`id` text PRIMARY KEY,
	`lookup_key` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`unit_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`recurring_interval` text,
	`fetched_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "payment_price_snapshots_currency_check" CHECK("currency" in ('usd')),
	CONSTRAINT "payment_price_snapshots_recurring_interval_check" CHECK("recurring_interval" in ('month'))
);
--> statement-breakpoint
CREATE TABLE `payment_purchases` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text,
	`related_id` text,
	`exclusivity_key` text,
	`status` text DEFAULT 'open' NOT NULL,
	`rejection_reason` text,
	`state_token` text NOT NULL,
	`price_lookup_key` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`unit_amount` integer NOT NULL,
	`quantity` integer NOT NULL,
	`amount_total` integer NOT NULL,
	`summary_json` text NOT NULL,
	`deadline_at` integer,
	`accept_until` integer,
	`fulfillable_until` integer,
	`expires_at` integer NOT NULL,
	`stripe_checkout_session_id` text,
	`stripe_payment_intent_id` text,
	`stripe_invoice_id` text,
	`stripe_subscription_id` text,
	`consented_at` integer,
	`consent_version` text,
	`paid_at` integer,
	`reflected_at` integer,
	`confirmation_email_status` text DEFAULT 'none' NOT NULL,
	`last_event_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_payment_purchases_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "payment_purchases_kind_check" CHECK("kind" in ('week_tournament_entry', 'year_tournament_entry', 'sponsorship', 'ultras', 'payments_smoke')),
	CONSTRAINT "payment_purchases_status_check" CHECK("status" in ('open', 'processing', 'fulfilled', 'rejected', 'expired', 'superseded')),
	CONSTRAINT "payment_purchases_rejection_reason_check" CHECK("rejection_reason" in ('late', 'ineligible', 'duplicate')),
	CONSTRAINT "payment_purchases_confirmation_email_status_check" CHECK("confirmation_email_status" in ('none', 'pending', 'requested', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `payment_records` (
	`id` text PRIMARY KEY,
	`pseudonymous_id` text NOT NULL,
	`kind` text NOT NULL,
	`purpose` text NOT NULL,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`quantity` integer,
	`stripe_reference` text NOT NULL,
	`related_id` text,
	`purchase_id` text,
	`consented_at` integer,
	`consent_version` text,
	`link_funding_source_group` text,
	`occurred_at` integer NOT NULL,
	`last_event_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "payment_records_kind_check" CHECK("kind" in ('one_time', 'subscription', 'refund', 'dispute')),
	CONSTRAINT "payment_records_purpose_check" CHECK("purpose" in ('week_tournament_entry', 'year_tournament_entry', 'sponsorship', 'ultras', 'payments_smoke')),
	CONSTRAINT "payment_records_status_check" CHECK("status" in ('succeeded', 'failed', 'pending', 'disputed', 'dispute_won', 'dispute_lost')),
	CONSTRAINT "payment_records_currency_check" CHECK("currency" in ('usd'))
);
--> statement-breakpoint
CREATE TABLE `payment_refunds` (
	`id` text PRIMARY KEY,
	`purchase_id` text NOT NULL,
	`request_key` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`stripe_refund_id` text,
	`failure_code` text,
	`dispatched_at` integer,
	`notice_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_payment_refunds_purchase_id_payment_purchases_id_fk` FOREIGN KEY (`purchase_id`) REFERENCES `payment_purchases`(`id`),
	CONSTRAINT "payment_refunds_status_check" CHECK("status" in ('requested', 'submitted', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "payment_refunds_notice_status_check" CHECK("notice_status" in ('none', 'pending', 'requested', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `payment_stripe_objects` (
	`id` text PRIMARY KEY,
	`object_id` text NOT NULL,
	`object_type` text NOT NULL,
	`last_event_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "payment_stripe_objects_object_type_check" CHECK("object_type" in ('subscription'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_customers_user_id_unique` ON `payment_customers` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_customers_stripe_customer_id_unique` ON `payment_customers` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_price_snapshots_lookup_key_unique` ON `payment_price_snapshots` (`lookup_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_purchases_stripe_checkout_session_id_unique` ON `payment_purchases` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_purchases_exclusivity_key_fulfilled_unique` ON `payment_purchases` (`exclusivity_key`) WHERE "payment_purchases"."status" = 'fulfilled';--> statement-breakpoint
CREATE INDEX `payment_purchases_user_id_status_idx` ON `payment_purchases` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_purchases_status_deadline_at_idx` ON `payment_purchases` (`status`,`deadline_at`);--> statement-breakpoint
CREATE INDEX `payment_purchases_status_expires_at_idx` ON `payment_purchases` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `payment_purchases_user_id_kind_target_id_status_idx` ON `payment_purchases` (`user_id`,`kind`,`target_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_purchases_stripe_payment_intent_id_idx` ON `payment_purchases` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_records_stripe_reference_kind_unique` ON `payment_records` (`stripe_reference`,`kind`) WHERE "payment_records"."kind" <> 'dispute';--> statement-breakpoint
CREATE UNIQUE INDEX `payment_records_stripe_reference_kind_status_dispute_unique` ON `payment_records` (`stripe_reference`,`kind`,`status`) WHERE "payment_records"."kind" = 'dispute';--> statement-breakpoint
CREATE INDEX `payment_records_pseudonymous_id_occurred_at_id_idx` ON `payment_records` (`pseudonymous_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `payment_records_occurred_at_idx` ON `payment_records` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `payment_records_recorded_at_idx` ON `payment_records` (`recorded_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_refunds_request_key_unique` ON `payment_refunds` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_refunds_stripe_refund_id_unique` ON `payment_refunds` (`stripe_refund_id`);--> statement-breakpoint
CREATE INDEX `payment_refunds_purchase_id_idx` ON `payment_refunds` (`purchase_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_stripe_objects_object_id_unique` ON `payment_stripe_objects` (`object_id`);