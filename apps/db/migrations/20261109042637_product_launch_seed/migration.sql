INSERT INTO `product_categories` (`id`, `name`, `handle`, `system_default`, `created_at`, `updated_at`) VALUES
	('01JD0000000000000000000000', 'その他', 'other', 1, 1731945562112, 1731945562112)
ON CONFLICT (`name`) DO NOTHING;
