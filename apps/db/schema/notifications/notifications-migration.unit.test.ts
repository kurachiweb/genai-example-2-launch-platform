import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { decodeTime } from 'ulid';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_notifications';

const SEED_MIGRATION_SUFFIX = '_notifications_seed';

const SENDER_INFO_SETTING_ID = '01M7BNN5000000000000000001';

const SENDER_INFO_SEEDED_AT = 1794614400000;

const NOTIFICATION_TABLES = [
  'notification_preferences',
  'notification_unsubscribe_tokens',
  'notification_sender_settings',
  'notification_events',
  'notification_slots',
  'notification_slot_ready_marks',
  'notification_notices',
] as const;

const TOPIC_VALUES = `('match_preview', 'match_result', 'followed_user_match', 'followed_user_award')`;

const migrationDirectoryNames = (): string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const migrationNameEndingWith = (suffix: string): string => {
  const found = migrationDirectoryNames().find((name) => name.endsWith(suffix));
  if (found === undefined) {
    throw new Error(`${suffix}で終わるマイグレーションがありません`);
  }
  return found;
};

const migrationSqlOf = (suffix: string): string =>
  readFileSync(
    join(MIGRATIONS_DIR, migrationNameEndingWith(suffix), 'migration.sql'),
    'utf8',
  );

const tableMigrationSql = (): string => migrationSqlOf(TABLE_MIGRATION_SUFFIX);

const createTableOf = (tableName: string): string => {
  const statement = tableMigrationSql()
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`CREATE TABLE \`${tableName}\` (`));
  if (statement === undefined) {
    throw new Error(`${tableName}を作る文がありません`);
  }
  return statement;
};

describe('notificationsのテーブルのマイグレーション', () => {
  test.each(NOTIFICATION_TABLES)('%sを作る文を含む', (tableName) => {
    expect(createTableOf(tableName)).toContain('`id` text PRIMARY KEY');
  });

  test.each([
    [
      'notification_preferences',
      `CONSTRAINT "notification_preferences_topic_check" CHECK("topic" in ${TOPIC_VALUES})`,
    ],
    [
      'notification_preferences',
      'CONSTRAINT "notification_preferences_enabled_check" CHECK("enabled" in (0, 1))',
    ],
    [
      'notification_unsubscribe_tokens',
      `CONSTRAINT "notification_unsubscribe_tokens_topic_check" CHECK("topic" in ${TOPIC_VALUES})`,
    ],
    [
      'notification_sender_settings',
      'CONSTRAINT "notification_sender_settings_version_check" CHECK("version" >= 0)',
    ],
    [
      'notification_sender_settings',
      'CONSTRAINT "notification_sender_settings_values_by_version_check" CHECK(("version" = 0 and "business_name" is null and "contact_email" is null and "postal_address" is null) or ("version" >= 1 and "business_name" is not null and "contact_email" is not null and "postal_address" is not null))',
    ],
    [
      'notification_events',
      `CONSTRAINT "notification_events_type_check" CHECK("type" in ('match_preview', 'match_result', 'award'))`,
    ],
    [
      'notification_events',
      `CONSTRAINT "notification_events_status_check" CHECK("status" in ('pending', 'expanded'))`,
    ],
    [
      'notification_events',
      `CONSTRAINT "notification_events_award_check" CHECK("award" in ('product_of_the_week', 'product_of_the_year'))`,
    ],
    [
      'notification_slots',
      `CONSTRAINT "notification_slots_kind_check" CHECK("kind" in ('evening', 'morning', 'award'))`,
    ],
    [
      'notification_slots',
      `CONSTRAINT "notification_slots_phase_check" CHECK("phase" in ('waiting', 'collecting', 'sending', 'done'))`,
    ],
    [
      'notification_notices',
      `CONSTRAINT "notification_notices_topic_check" CHECK("topic" in ${TOPIC_VALUES})`,
    ],
    [
      'notification_notices',
      `CONSTRAINT "notification_notices_status_check" CHECK("status" in ('pending', 'sent', 'skipped'))`,
    ],
    [
      'notification_notices',
      `CONSTRAINT "notification_notices_skip_reason_check" CHECK("skip_reason" in ('topic_disabled', 'recipient_unavailable', 'email_not_verified', 'suppressed', 'sender_info_missing', 'own_product_unavailable', 'stale', 'recipient_withdrawn', 'send_rejected', 'expired'))`,
    ],
  ])('%sは値を限るCHECKを含む: %s', (tableName, constraint) => {
    expect(createTableOf(tableName)).toContain(constraint);
  });

  test.each([
    [
      'notification_preferences_user_id_topic_unique',
      'notification_preferences',
      '`user_id`,`topic`',
    ],
    [
      'notification_unsubscribe_tokens_user_id_topic_unique',
      'notification_unsubscribe_tokens',
      '`user_id`,`topic`',
    ],
    [
      'notification_unsubscribe_tokens_token_hash_unique',
      'notification_unsubscribe_tokens',
      '`token_hash`',
    ],
    [
      'notification_sender_settings_setting_key_unique',
      'notification_sender_settings',
      '`setting_key`',
    ],
    [
      'notification_events_dedupe_key_unique',
      'notification_events',
      '`dedupe_key`',
    ],
    ['notification_slots_slot_key_unique', 'notification_slots', '`slot_key`'],
    [
      'notification_slot_ready_marks_slot_key_participant_unique',
      'notification_slot_ready_marks',
      '`slot_key`,`participant`',
    ],
    [
      'notification_notices_dedupe_key_unique',
      'notification_notices',
      '`dedupe_key`',
    ],
  ])('一意索引%sを含む', (indexName, tableName, columns) => {
    expect(tableMigrationSql()).toContain(
      `CREATE UNIQUE INDEX \`${indexName}\` ON \`${tableName}\` (${columns});`,
    );
  });

  test.each([
    'CREATE INDEX `notification_preferences_topic_enabled_user_id_idx` ON `notification_preferences` (`topic`,`enabled`,`user_id`);',
    'CREATE INDEX `notification_events_status_last_dispatched_at_idx` ON `notification_events` (`status`,`last_dispatched_at`);',
    'CREATE INDEX `notification_events_status_expanded_at_idx` ON `notification_events` (`status`,`expanded_at`);',
    'CREATE INDEX `notification_slots_phase_settle_until_idx` ON `notification_slots` (`phase`,`settle_until`);',
    'CREATE INDEX `notification_slots_phase_completed_at_idx` ON `notification_slots` (`phase`,`completed_at`);',
    'CREATE INDEX `notification_notices_slot_key_status_group_key_id_idx` ON `notification_notices` (`slot_key`,`status`,`group_key`,`id`);',
    'CREATE INDEX `notification_notices_recipient_user_id_idx` ON `notification_notices` (`recipient_user_id`);',
    'CREATE INDEX `notification_notices_status_settled_at_idx` ON `notification_notices` (`status`,`settled_at`);',
  ])('索引を含む: %s', (statement) => {
    expect(tableMigrationSql()).toContain(statement);
  });

  test('送信枠は送り出しの前提の一覧と依頼の時刻の列をNULLを許す列として持つ', () => {
    const statement = createTableOf('notification_slots');

    expect(statement).toContain('`required_participants` text,');
    expect(statement).toContain('`dispatch_requested_at` integer,');
  });

  test('準備の完了のテーブルは作成日時だけを持ち、更新日時を持たない', () => {
    const statement = createTableOf('notification_slot_ready_marks');

    expect(statement).toContain('`created_at` integer NOT NULL');
    expect(statement).not.toContain('`updated_at`');
  });

  test('外部キーはusersへの3つだけで、ON DELETEを指定しない', () => {
    const sql = tableMigrationSql();

    expect(sql).not.toMatch(/ON DELETE/i);
    expect(sql.match(/FOREIGN KEY/g)).toHaveLength(3);
    expect(createTableOf('notification_preferences')).toContain(
      'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)',
    );
    expect(createTableOf('notification_unsubscribe_tokens')).toContain(
      'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)',
    );
    expect(createTableOf('notification_notices')).toContain(
      'FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`)',
    );
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(tableMigrationSql()).not.toContain('INSERT');
  });
});

describe('送信者情報の初期データのマイグレーション', () => {
  test('テーブルを作るマイグレーションの直後に適用される別のカスタムマイグレーションとして置く', () => {
    const names = migrationDirectoryNames();
    const tableAt = names.indexOf(
      migrationNameEndingWith(TABLE_MIGRATION_SUFFIX),
    );

    expect(names.indexOf(migrationNameEndingWith(SEED_MIGRATION_SUFFIX))).toBe(
      tableAt + 1,
    );
  });

  test('全列を明示して、鍵sender-infoの行を3項目NULL・版0・管理者なしで入れ、鍵の重複を無視する', () => {
    expect(migrationSqlOf(SEED_MIGRATION_SUFFIX)).toBe(
      [
        'INSERT INTO `notification_sender_settings` (`id`, `setting_key`, `business_name`, `contact_email`, `postal_address`, `version`, `updated_by_admin_id`, `created_at`, `updated_at`) VALUES',
        `\t('${SENDER_INFO_SETTING_ID}', 'sender-info', NULL, NULL, NULL, 0, NULL, ${String(SENDER_INFO_SEEDED_AT)}, ${String(SENDER_INFO_SEEDED_AT)})`,
        'ON CONFLICT (`setting_key`) DO NOTHING;',
        '',
      ].join('\n'),
    );
  });

  test('作成日時と更新日時は固定のIDのULIDの時刻部が表す時刻にする', () => {
    expect(decodeTime(SENDER_INFO_SETTING_ID)).toBe(SENDER_INFO_SEEDED_AT);
  });
});
