CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`scope_products` text NOT NULL,
	`scope_launches` text NOT NULL,
	`scope_upvotes` text NOT NULL,
	`scope_comments` text NOT NULL,
	`scope_ratings` text NOT NULL,
	`scope_profile` text NOT NULL,
	`scope_product_descriptions` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_api_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT "api_keys_scope_products_check" CHECK("scope_products" in ('none', 'read')),
	CONSTRAINT "api_keys_scope_launches_check" CHECK("scope_launches" in ('none', 'read')),
	CONSTRAINT "api_keys_scope_upvotes_check" CHECK("scope_upvotes" in ('none', 'read')),
	CONSTRAINT "api_keys_scope_comments_check" CHECK("scope_comments" in ('none', 'read')),
	CONSTRAINT "api_keys_scope_ratings_check" CHECK("scope_ratings" in ('none', 'read')),
	CONSTRAINT "api_keys_scope_profile_check" CHECK("scope_profile" in ('none', 'read', 'read_write')),
	CONSTRAINT "api_keys_scope_product_descriptions_check" CHECK("scope_product_descriptions" in ('none', 'read', 'read_write'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_id_created_at_id_idx` ON `api_keys` (`user_id`,`created_at`,`id`);