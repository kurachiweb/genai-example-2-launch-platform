INSERT INTO `inquiry_categories` (`id`, `name`, `system_default`, `created_at`, `updated_at`) VALUES
	('01JC0000000000000000000000', 'その他', 1, 1730871820288, 1730871820288)
ON CONFLICT (`name`) DO NOTHING;
