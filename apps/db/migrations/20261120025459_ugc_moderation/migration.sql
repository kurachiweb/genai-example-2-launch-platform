CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY,
	`action` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`subject_user_id` text,
	`product_id` text,
	`operator_admin_id` text NOT NULL,
	`reason` text,
	`lifecycle_event_id` text,
	`occurred_at` integer NOT NULL,
	`notice_status` text NOT NULL,
	`notice_requested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "moderation_actions_action_check" CHECK("action" in ('user.suspend', 'user.unsuspend', 'user.administrative-withdraw', 'product.hide', 'product.unhide', 'comment.hide', 'comment.unhide', 'rating.invalidate', 'rating.revalidate', 'image.approve', 'image.quarantine', 'image.release', 'image.delete')),
	CONSTRAINT "moderation_actions_target_kind_check" CHECK("target_kind" in ('user', 'product', 'comment', 'rating', 'image')),
	CONSTRAINT "moderation_actions_notice_status_check" CHECK("notice_status" in ('none', 'pending', 'requested', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `moderation_actions_target_kind_target_id_occurred_at_idx` ON `moderation_actions` (`target_kind`,`target_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `moderation_actions_notice_status_occurred_at_idx` ON `moderation_actions` (`notice_status`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `moderation_actions_subject_user_id_idx` ON `moderation_actions` (`subject_user_id`);--> statement-breakpoint
CREATE INDEX `moderation_actions_product_id_idx` ON `moderation_actions` (`product_id`);--> statement-breakpoint
CREATE INDEX `moderation_actions_occurred_at_idx` ON `moderation_actions` (`occurred_at`);