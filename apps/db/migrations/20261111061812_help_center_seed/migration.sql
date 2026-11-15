INSERT INTO `help_categories` (`id`, `name`, `system_default`, `sort_order`, `created_at`, `updated_at`) VALUES
	('01JC0000000000000000000001', 'その他', 1, 1, 1730871820288, 1730871820288)
ON CONFLICT (`name`) DO NOTHING;
