INSERT INTO `notification_sender_settings` (`id`, `setting_key`, `business_name`, `contact_email`, `postal_address`, `version`, `updated_by_admin_id`, `created_at`, `updated_at`) VALUES
	('01M7BNN5000000000000000001', 'sender-info', NULL, NULL, NULL, 0, NULL, 1794614400000, 1794614400000)
ON CONFLICT (`setting_key`) DO NOTHING;
