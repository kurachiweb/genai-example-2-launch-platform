INSERT INTO `ultras_settings` (`id`, `setting_key`, `enabled`, `version`, `updated_by_admin_id`, `created_at`, `updated_at`) VALUES
	('01M6Q2FD000000000000000001', 'ultras_promotion', 0, 0, NULL, 1793923200000, 1793923200000)
ON CONFLICT (`setting_key`) DO NOTHING;
