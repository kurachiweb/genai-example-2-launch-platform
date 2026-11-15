INSERT INTO `legal_documents` (`id`, `kind`, `state_version`, `latest_version_number`, `draft_body`, `draft_saved_at`, `draft_saved_by_admin_id`, `created_at`, `updated_at`) VALUES
	('01M6HXNZ000000000000000001', 'terms', 0, 0, NULL, NULL, NULL, 1793750400000, 1793750400000),
	('01M6HXNZ000000000000000002', 'privacy', 0, 0, NULL, NULL, NULL, 1793750400000, 1793750400000),
	('01M6HXNZ000000000000000003', 'legal-notice', 0, 0, NULL, NULL, NULL, 1793750400000, 1793750400000)
ON CONFLICT (`kind`) DO NOTHING;
