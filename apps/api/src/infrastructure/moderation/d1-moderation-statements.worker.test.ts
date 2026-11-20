import { beforeEach, describe, expect, test } from 'vitest';

import { D1ModerationRecordStore } from '../../../lib/workers/moderation/d1-moderation-record-store.ts';
import {
  db,
  moderatedProductIdOf,
  moderatedUserIdOf,
  moderationIdOf,
  newRecordOf,
  OPERATOR_ADMIN_ID,
  readModerationRows,
  T0,
} from '../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { D1ModerationStatements } from './d1-moderation-statements.ts';
import {
  auditLogIdOf,
  auditOf,
  clearModerationWrites,
  readModerationAuditLogs,
} from './testing/moderation-write-fixtures.ts';

const statements = new D1ModerationStatements(
  db,
  new D1ModerationRecordStore(db),
);

const REASON = '規約に反する名称のため';

const record = newRecordOf(1, {
  action: 'product.hide',
  targetId: moderatedProductIdOf(1),
  subjectUserId: moderatedUserIdOf(1),
  productId: moderatedProductIdOf(1),
  reason: REASON,
  noticeStatus: 'pending',
});

const audit = auditOf({
  index: 1,
  action: 'product.hide',
  targetKind: 'product',
  targetId: moderatedProductIdOf(1),
  occurredAt: T0,
  reason: REASON,
});

beforeEach(clearModerationWrites);

describe('D1ModerationStatements', () => {
  test('措置の記録の挿入の文を先に、監査ログと対象の挿入の文を後に並べる', async () => {
    const items = statements.forRecord(record, audit);
    const [first, ...rest] = items;
    if (first === undefined) {
      throw new Error('文が1つも返されませんでした');
    }

    await db.batch([first]);
    expect(await readModerationRows()).toHaveLength(1);
    expect(await readModerationAuditLogs()).toStrictEqual([]);

    const [second, ...others] = rest;
    if (second === undefined) {
      throw new Error('監査ログの文が返されませんでした');
    }
    await db.batch([second, ...others]);
    expect(items).toHaveLength(3);
  });

  test('返した文を1つの一括の書き込みで確定すると、記録と監査ログが同じ措置として残る', async () => {
    const [first, ...rest] = statements.forRecord(record, audit);
    if (first === undefined) {
      throw new Error('文が1つも返されませんでした');
    }

    await db.batch([first, ...rest]);

    expect(await readModerationRows()).toStrictEqual([
      expect.objectContaining({
        id: moderationIdOf(1),
        action: 'product.hide',
        targetKind: 'product',
        targetId: moderatedProductIdOf(1),
        subjectUserId: moderatedUserIdOf(1),
        productId: moderatedProductIdOf(1),
        operatorAdminId: OPERATOR_ADMIN_ID,
        reason: REASON,
        occurredAt: T0,
        noticeStatus: 'pending',
        noticeRequestedAt: null,
      }),
    ]);
    expect(await readModerationAuditLogs()).toStrictEqual([
      expect.objectContaining({
        id: auditLogIdOf(1),
        operatorAdminId: OPERATOR_ADMIN_ID,
        action: 'product.hide',
        targetKind: 'product',
        reason: REASON,
        detail: {},
        occurredAt: T0,
        targets: [{ targetKind: 'product', targetId: moderatedProductIdOf(1) }],
      }),
    ]);
  });
});
