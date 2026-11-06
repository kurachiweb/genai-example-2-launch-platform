import { describe, expect, test } from 'bun:test';

import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

import * as schema from './index.ts';

const exportedTableNames = Object.values(schema)
  .filter((value) => value instanceof SQLiteTable)
  .map((table) => getTableConfig(table).name);

describe('スキーマの集約点', () => {
  test.each([
    'email_suppressions',
    'email_send_records',
    'email_alert_throttles',
    'email_cleanup_cursors',
    'media_files',
    'media_file_quarantine_reasons',
    'users',
    'user_sessions',
    'user_auth_tokens',
    'user_login_challenges',
    'user_totp_credentials',
    'user_recovery_codes',
    'user_lifecycle_events',
    'user_lifecycle_handler_runs',
    'admins',
    'admin_sessions',
    'admin_auth_tokens',
    'admin_login_challenges',
    'admin_totp_credentials',
    'admin_recovery_codes',
    'admin_audit_logs',
    'admin_audit_log_targets',
    'legal_documents',
    'legal_document_versions',
    'inquiry_categories',
    'member_inquiries',
    'guest_inquiries',
    'inquiry_messages',
    'inquiry_message_attachments',
    'payment_customers',
    'payment_purchases',
    'payment_records',
    'payment_refunds',
    'payment_stripe_objects',
    'payment_price_snapshots',
    'ultras_subscriptions',
    'ultras_activations',
    'ultras_notices',
    'ultras_settings',
  ])(
    'マイグレーションの生成が読むテーブル定義として、%sを再エクスポートする',
    (tableName) => {
      expect(exportedTableNames).toContain(tableName);
    },
  );
});
