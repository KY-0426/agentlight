CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`email` varchar(254) NOT NULL,
	`phone_number` varchar(16),
	`password_hash` text NOT NULL,
	`display_name` varchar(20) NOT NULL,
	`disabled_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_phone_number_unique` UNIQUE(`phone_number`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`role` enum('owner','admin','member') NOT NULL DEFAULT 'member',
	`joined_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `workspace_members_workspace_id_user_id_pk` PRIMARY KEY(`workspace_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`installation_id` varchar(128) NOT NULL,
	`platform` enum('macos','windows') NOT NULL,
	`app_version` varchar(40) NOT NULL,
	`device_label` varchar(120),
	`last_seen_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `devices_installation_unique` UNIQUE(`installation_id`)
);
--> statement-breakpoint
CREATE TABLE `hardware_devices` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`device_id` char(36) NOT NULL,
	`hardware_device_id` varchar(128) NOT NULL,
	`firmware_version` varchar(40) NOT NULL,
	`protocol_version` varchar(40) NOT NULL,
	`hardware_revision` varchar(40) NOT NULL,
	`bound_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `hardware_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `hardware_devices_hardware_unique` UNIQUE(`hardware_device_id`)
);
--> statement-breakpoint
CREATE TABLE `codex_threads` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`device_id` char(36) NOT NULL,
	`agent_provider` enum('codex','claude_code','cursor','github_copilot','trae','trae_cn','qoder','qoder_cn','codebuddy','antigravity','kiro','devin') NOT NULL DEFAULT 'codex',
	`codex_thread_id` varchar(128) NOT NULL,
	`model` varchar(80),
	`tokens_used` bigint NOT NULL DEFAULT 0,
	`thread_updated_at_ms` bigint NOT NULL,
	`last_uploaded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `codex_threads_id` PRIMARY KEY(`id`),
	CONSTRAINT `codex_threads_idempotency_unique` UNIQUE(`workspace_id`,`user_id`,`device_id`,`agent_provider`,`codex_thread_id`)
);
--> statement-breakpoint
CREATE TABLE `daily_usage_rollups` (
	`workspace_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`agent_provider` enum('codex','claude_code','cursor','github_copilot','trae','trae_cn','qoder','qoder_cn','codebuddy','antigravity','kiro','devin') NOT NULL DEFAULT 'codex',
	`usage_date` date NOT NULL,
	`tokens_used` bigint NOT NULL DEFAULT 0,
	`thread_count` int NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `daily_usage_rollups_pk` PRIMARY KEY(`workspace_id`,`user_id`,`usage_date`,`agent_provider`)
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`device_id` char(36) NOT NULL,
	`agent_provider` enum('codex','claude_code','cursor','github_copilot','trae','trae_cn','qoder','qoder_cn','codebuddy','antigravity','kiro','devin') NOT NULL DEFAULT 'codex',
	`codex_thread_id` char(36) NOT NULL,
	`tokens_used` bigint NOT NULL,
	`delta_tokens` bigint NOT NULL,
	`ignored_stale_value` boolean NOT NULL DEFAULT false,
	`sampled_at_ms` bigint NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `usage_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `phone_verification_codes` (
	`id` char(36) NOT NULL,
	`phone_number` varchar(16) NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`purpose` varchar(32) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`attempts` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `phone_verification_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `activation_codes` (
	`id` char(36) NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`status` enum('active','used','revoked') NOT NULL DEFAULT 'active',
	`label` varchar(200),
	`expires_at` datetime(3),
	`used_at` datetime(3),
	`user_id` char(36),
	`activated_installation_id` varchar(128),
	`activated_platform` enum('macos','windows'),
	`activated_app_version` varchar(40),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activation_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `activation_codes_code_hash_unique` UNIQUE(`code_hash`)
);
--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`id` char(36) NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`status` enum('active','used','revoked') NOT NULL DEFAULT 'active',
	`workspace_id` char(36),
	`created_by_user_id` char(36),
	`used_by_user_id` char(36),
	`expires_at` datetime(3),
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invite_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `invite_codes_code_hash_unique` UNIQUE(`code_hash`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` char(36) NOT NULL,
	`username` varchar(64) NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` varchar(120) NOT NULL,
	`disabled_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `hardware_devices` ADD CONSTRAINT `hardware_devices_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `hardware_devices` ADD CONSTRAINT `hardware_devices_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `codex_threads` ADD CONSTRAINT `codex_threads_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `codex_threads` ADD CONSTRAINT `codex_threads_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `codex_threads` ADD CONSTRAINT `codex_threads_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `daily_usage_rollups` ADD CONSTRAINT `daily_usage_rollups_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `daily_usage_rollups` ADD CONSTRAINT `daily_usage_rollups_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `usage_events` ADD CONSTRAINT `usage_events_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `usage_events` ADD CONSTRAINT `usage_events_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `usage_events` ADD CONSTRAINT `usage_events_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `usage_events` ADD CONSTRAINT `usage_events_codex_thread_id_codex_threads_id_fk` FOREIGN KEY (`codex_thread_id`) REFERENCES `codex_threads`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `activation_codes` ADD CONSTRAINT `activation_codes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `invite_codes` ADD CONSTRAINT `invite_codes_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `invite_codes` ADD CONSTRAINT `invite_codes_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `invite_codes` ADD CONSTRAINT `invite_codes_used_by_user_id_users_id_fk` FOREIGN KEY (`used_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`user_id`);
--> statement-breakpoint
CREATE INDEX `devices_workspace_user_idx` ON `devices` (`workspace_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `hardware_devices_device_idx` ON `hardware_devices` (`device_id`);
--> statement-breakpoint
CREATE INDEX `hardware_devices_workspace_idx` ON `hardware_devices` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `codex_threads_workspace_user_idx` ON `codex_threads` (`workspace_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `codex_threads_device_idx` ON `codex_threads` (`device_id`);
--> statement-breakpoint
CREATE INDEX `daily_usage_rollups_leaderboard_idx` ON `daily_usage_rollups` (`workspace_id`,`agent_provider`,`usage_date`);
--> statement-breakpoint
CREATE INDEX `usage_events_workspace_user_idx` ON `usage_events` (`workspace_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `usage_events_thread_idx` ON `usage_events` (`codex_thread_id`);
--> statement-breakpoint
CREATE INDEX `phone_verification_codes_phone_purpose_idx` ON `phone_verification_codes` (`phone_number`,`purpose`);
--> statement-breakpoint
CREATE INDEX `activation_codes_status_idx` ON `activation_codes` (`status`);
--> statement-breakpoint
CREATE INDEX `activation_codes_installation_idx` ON `activation_codes` (`activated_installation_id`);
--> statement-breakpoint
CREATE INDEX `activation_codes_user_idx` ON `activation_codes` (`user_id`);
--> statement-breakpoint
CREATE INDEX `invite_codes_status_idx` ON `invite_codes` (`status`);
--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);
--> statement-breakpoint
INSERT INTO `admin_users` (`id`, `username`, `password_hash`, `display_name`)
VALUES (
	UUID(),
	'admin',
	'scrypt$ss8KZjFJ-ybnamV8oRShxA$f2UhW2OphYnRQgse7o6Fpxq2M4qazvCpaE4BFJ7oG4N8VWwFRGCdZJCRPUlMndlcEq_XX1EeT2ozO9ZtCZAbAg',
	'Administrator'
);
