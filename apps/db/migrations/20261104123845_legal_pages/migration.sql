CREATE TABLE `legal_document_versions` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`body` text NOT NULL,
	`change_summary` text NOT NULL,
	`published_at` integer NOT NULL,
	`published_by_admin_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_legal_document_versions_document_id_legal_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `legal_documents`(`id`)
);
--> statement-breakpoint
CREATE TABLE `legal_documents` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`state_version` integer DEFAULT 0 NOT NULL,
	`latest_version_number` integer DEFAULT 0 NOT NULL,
	`draft_body` text,
	`draft_saved_at` integer,
	`draft_saved_by_admin_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "legal_documents_kind_check" CHECK("kind" in ('terms', 'privacy', 'legal-notice'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_document_versions_document_id_version_number_unique` ON `legal_document_versions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `legal_document_versions_document_id_published_at_idx` ON `legal_document_versions` (`document_id`,`published_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `legal_documents_kind_unique` ON `legal_documents` (`kind`);