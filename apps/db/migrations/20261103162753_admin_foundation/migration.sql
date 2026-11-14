CREATE TABLE `admin_audit_log_targets` (
	`id` text PRIMARY KEY,
	`log_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_admin_audit_log_targets_log_id_admin_audit_logs_id_fk` FOREIGN KEY (`log_id`) REFERENCES `admin_audit_logs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY,
	`operator_admin_id` text NOT NULL,
	`action` text NOT NULL,
	`target_kind` text,
	`reason` text,
	`detail` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_auth_tokens` (
	`id` text PRIMARY KEY,
	`admin_id` text NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`expires_at` integer NOT NULL,
	`new_email` text collate nocase,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_admin_auth_tokens_admin_id_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`),
	CONSTRAINT "admin_auth_tokens_purpose_check" CHECK("purpose" in ('invitation', 'email_change', 'password_reset'))
);
--> statement-breakpoint
CREATE TABLE `admin_login_challenges` (
	`id` text PRIMARY KEY,
	`admin_id` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_admin_login_challenges_admin_id_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_recovery_codes` (
	`id` text PRIMARY KEY,
	`admin_id` text NOT NULL,
	`code_hash` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_admin_recovery_codes_admin_id_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY,
	`admin_id` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`user_agent` text,
	`last_used_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_admin_sessions_admin_id_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_totp_credentials` (
	`id` text PRIMARY KEY,
	`admin_id` text NOT NULL UNIQUE,
	`sealed_secret` text,
	`enabled_at` integer,
	`last_used_step` integer,
	`pending_sealed_secret` text,
	`pending_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_admin_totp_credentials_admin_id_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`)
);
--> statement-breakpoint
CREATE TABLE `admins` (
	`id` text PRIMARY KEY,
	`email` text collate nocase NOT NULL UNIQUE,
	`password_hash` text,
	`nickname` text,
	`title` text,
	`avatar_file_id` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`invitation_expires_at` integer,
	`activated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "admins_role_check" CHECK("role" in ('viewer', 'moderator', 'super_admin')),
	CONSTRAINT "admins_status_check" CHECK("status" in ('invited', 'active'))
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_targets_target_kind_target_id_log_id_idx` ON `admin_audit_log_targets` (`target_kind`,`target_id`,`log_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_targets_log_id_idx` ON `admin_audit_log_targets` (`log_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_logs_occurred_at_id_idx` ON `admin_audit_logs` (`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `admin_audit_logs_operator_admin_id_occurred_at_idx` ON `admin_audit_logs` (`operator_admin_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_logs_action_occurred_at_idx` ON `admin_audit_logs` (`action`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `admin_auth_tokens_admin_id_purpose_idx` ON `admin_auth_tokens` (`admin_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `admin_auth_tokens_expires_at_idx` ON `admin_auth_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `admin_login_challenges_expires_at_idx` ON `admin_login_challenges` (`expires_at`);--> statement-breakpoint
CREATE INDEX `admin_recovery_codes_admin_id_idx` ON `admin_recovery_codes` (`admin_id`);--> statement-breakpoint
CREATE INDEX `admin_sessions_admin_id_idx` ON `admin_sessions` (`admin_id`);--> statement-breakpoint
CREATE INDEX `admin_sessions_last_used_at_idx` ON `admin_sessions` (`last_used_at`);--> statement-breakpoint
CREATE INDEX `admin_sessions_absolute_expires_at_idx` ON `admin_sessions` (`absolute_expires_at`);--> statement-breakpoint
CREATE INDEX `admin_totp_credentials_pending_expires_at_idx` ON `admin_totp_credentials` (`pending_expires_at`);--> statement-breakpoint
CREATE INDEX `admins_role_status_idx` ON `admins` (`role`,`status`);