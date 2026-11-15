CREATE TABLE `user_follows` (
	`id` text PRIMARY KEY,
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_user_follows_follower_id_users_id_fk` FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_user_follows_followee_id_users_id_fk` FOREIGN KEY (`followee_id`) REFERENCES `users`(`id`),
	CONSTRAINT "user_follows_not_self_check" CHECK("follower_id" <> "followee_id")
);
--> statement-breakpoint
CREATE TABLE `user_previous_handles` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL UNIQUE,
	`handle` text collate nocase NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_user_previous_handles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_profile_websites` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_profile_websites_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "user_profile_websites_position_check" CHECK("position" between 0 and 9)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL UNIQUE,
	`headline` text,
	`bio_markdown` text,
	`avatar_file_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_follows_follower_id_followee_id_unique` ON `user_follows` (`follower_id`,`followee_id`);--> statement-breakpoint
CREATE INDEX `user_follows_follower_id_created_at_id_idx` ON `user_follows` (`follower_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `user_follows_followee_id_created_at_id_idx` ON `user_follows` (`followee_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_websites_user_id_position_unique` ON `user_profile_websites` (`user_id`,`position`);