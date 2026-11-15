CREATE TABLE `launch_comments` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`launch_id` text NOT NULL,
	`parent_id` text,
	`root_id` text NOT NULL,
	`depth` integer NOT NULL,
	`author_user_id` text,
	`body` text NOT NULL,
	`edited_at` integer,
	`hidden_at` integer,
	`anonymized_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_launch_comments_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_launch_comments_launch_id_product_launches_id_fk` FOREIGN KEY (`launch_id`) REFERENCES `product_launches`(`id`),
	CONSTRAINT `fk_launch_comments_parent_id_launch_comments_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `launch_comments`(`id`),
	CONSTRAINT `fk_launch_comments_author_user_id_users_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "launch_comments_depth_check" CHECK("depth" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE `product_ratings` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`user_id` text NOT NULL,
	`score` integer NOT NULL,
	`invalidated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_product_ratings_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_product_ratings_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "product_ratings_score_check" CHECK("score" in (1, 2, 3, 4, 5))
);
--> statement-breakpoint
CREATE INDEX `launch_comments_launch_id_depth_created_at_id_idx` ON `launch_comments` (`launch_id`,`depth`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `launch_comments_root_id_created_at_id_idx` ON `launch_comments` (`root_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `launch_comments_author_user_id_idx` ON `launch_comments` (`author_user_id`);--> statement-breakpoint
CREATE INDEX `launch_comments_product_id_idx` ON `launch_comments` (`product_id`);--> statement-breakpoint
CREATE INDEX `launch_comments_deleted_at_idx` ON `launch_comments` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_ratings_product_id_user_id_unique` ON `product_ratings` (`product_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `product_ratings_user_id_idx` ON `product_ratings` (`user_id`);