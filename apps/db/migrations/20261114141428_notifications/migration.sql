CREATE TABLE `notification_events` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`publisher` text NOT NULL,
	`match_id` text,
	`award` text,
	`period` text,
	`product_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`cursor` text,
	`occurred_at` integer NOT NULL,
	`expanded_at` integer,
	`dispatch_count` integer DEFAULT 1 NOT NULL,
	`last_dispatched_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "notification_events_type_check" CHECK("type" in ('match_preview', 'match_result', 'award')),
	CONSTRAINT "notification_events_status_check" CHECK("status" in ('pending', 'expanded')),
	CONSTRAINT "notification_events_award_check" CHECK("award" in ('product_of_the_week', 'product_of_the_year'))
);
--> statement-breakpoint
CREATE TABLE `notification_notices` (
	`id` text PRIMARY KEY,
	`dedupe_key` text NOT NULL,
	`slot_key` text NOT NULL,
	`group_key` text NOT NULL,
	`topic` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`match_id` text,
	`entry_id` text,
	`product_id` text,
	`event_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`skip_reason` text,
	`email_request_id` text,
	`settled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_notification_notices_recipient_user_id_users_id_fk` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "notification_notices_topic_check" CHECK("topic" in ('match_preview', 'match_result', 'followed_user_match', 'followed_user_award')),
	CONSTRAINT "notification_notices_status_check" CHECK("status" in ('pending', 'sent', 'skipped')),
	CONSTRAINT "notification_notices_skip_reason_check" CHECK("skip_reason" in ('topic_disabled', 'recipient_unavailable', 'email_not_verified', 'suppressed', 'sender_info_missing', 'own_product_unavailable', 'stale', 'recipient_withdrawn', 'send_rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`topic` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_notification_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "notification_preferences_topic_check" CHECK("topic" in ('match_preview', 'match_result', 'followed_user_match', 'followed_user_award')),
	CONSTRAINT "notification_preferences_enabled_check" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `notification_sender_settings` (
	`id` text PRIMARY KEY,
	`setting_key` text NOT NULL,
	`business_name` text,
	`contact_email` text,
	`postal_address` text,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_by_admin_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "notification_sender_settings_version_check" CHECK("version" >= 0),
	CONSTRAINT "notification_sender_settings_values_by_version_check" CHECK(("version" = 0 and "business_name" is null and "contact_email" is null and "postal_address" is null) or ("version" >= 1 and "business_name" is not null and "contact_email" is not null and "postal_address" is not null))
);
--> statement-breakpoint
CREATE TABLE `notification_slot_ready_marks` (
	`id` text PRIMARY KEY,
	`slot_key` text NOT NULL,
	`participant` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_slots` (
	`id` text PRIMARY KEY,
	`slot_key` text NOT NULL,
	`kind` text NOT NULL,
	`due_at` integer NOT NULL,
	`settle_until` integer NOT NULL,
	`required_participants` text,
	`dispatch_requested_at` integer,
	`phase` text DEFAULT 'waiting' NOT NULL,
	`cursor` text,
	`lease_holder` text,
	`lease_until` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "notification_slots_kind_check" CHECK("kind" in ('evening', 'morning', 'award')),
	CONSTRAINT "notification_slots_phase_check" CHECK("phase" in ('waiting', 'collecting', 'sending', 'done'))
);
--> statement-breakpoint
CREATE TABLE `notification_unsubscribe_tokens` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`topic` text NOT NULL,
	`seed` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_notification_unsubscribe_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "notification_unsubscribe_tokens_topic_check" CHECK("topic" in ('match_preview', 'match_result', 'followed_user_match', 'followed_user_award'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_dedupe_key_unique` ON `notification_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_events_status_last_dispatched_at_idx` ON `notification_events` (`status`,`last_dispatched_at`);--> statement-breakpoint
CREATE INDEX `notification_events_status_expanded_at_idx` ON `notification_events` (`status`,`expanded_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_notices_dedupe_key_unique` ON `notification_notices` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_notices_slot_key_status_group_key_id_idx` ON `notification_notices` (`slot_key`,`status`,`group_key`,`id`);--> statement-breakpoint
CREATE INDEX `notification_notices_recipient_user_id_idx` ON `notification_notices` (`recipient_user_id`);--> statement-breakpoint
CREATE INDEX `notification_notices_status_settled_at_idx` ON `notification_notices` (`status`,`settled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_user_id_topic_unique` ON `notification_preferences` (`user_id`,`topic`);--> statement-breakpoint
CREATE INDEX `notification_preferences_topic_enabled_user_id_idx` ON `notification_preferences` (`topic`,`enabled`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_sender_settings_setting_key_unique` ON `notification_sender_settings` (`setting_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_slot_ready_marks_slot_key_participant_unique` ON `notification_slot_ready_marks` (`slot_key`,`participant`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_slots_slot_key_unique` ON `notification_slots` (`slot_key`);--> statement-breakpoint
CREATE INDEX `notification_slots_phase_settle_until_idx` ON `notification_slots` (`phase`,`settle_until`);--> statement-breakpoint
CREATE INDEX `notification_slots_phase_completed_at_idx` ON `notification_slots` (`phase`,`completed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_unsubscribe_tokens_user_id_topic_unique` ON `notification_unsubscribe_tokens` (`user_id`,`topic`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_unsubscribe_tokens_token_hash_unique` ON `notification_unsubscribe_tokens` (`token_hash`);