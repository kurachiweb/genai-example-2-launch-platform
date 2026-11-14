import { beforeEach, describe, expect, test } from 'vitest';

import {
  ADMIN_ACCOUNT_INVITE_ACTION,
  ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
  USER_EMAIL_SEARCH_ACTION,
} from '../../../../../common-lib/admin/audit-actions/admin-foundation.ts';
import { issueAdminSession } from '../../../../../test/support/admin-graphql-harness.ts';
import {
  AUDIT_LOGS,
  type AuditLogPageFields,
  codesOf,
  installAdminGraphQLTest,
} from '../../../../../test/support/admin-graphql-operations.ts';
import {
  adminIdOf,
  after,
  auditLogIdOf,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  insertAdmin,
  pseudonymousIdOf,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

const { gateway } = installAdminGraphQLTest();

const OPERATOR = 1;

const DELETED_OPERATOR = 9;

const INVITED_TARGET = 5;

const ROLE_CHANGED_TARGET = 6;

const PAGE_SIZE = 50;

const MINUTE_MS = 60_000;

let sessionToken = '';

function searchAuditLogs(
  variables: Record<string, unknown> = {},
  options: { readonly signedIn?: boolean } = {},
) {
  return gateway.call<{ auditLogs: AuditLogPageFields | null }>(
    AUDIT_LOGS,
    variables,
    options.signedIn === false ? {} : { sessionToken },
  );
}

async function entryIdsOf(variables: Record<string, unknown>) {
  const response = await searchAuditLogs(variables);
  expect(response.errors).toBeUndefined();
  return response.data?.auditLogs?.entries.map((entry) => entry.id);
}

// 有効な操作者の招待とロールの変更、削除済みの操作者のメールアドレスの検索を、この順に1分ずつずらして記録する
async function recordThreeEntries(): Promise<void> {
  const recorder = createAuditLogRecorder({
    ids: createSequentialAuditLogIds(),
  });
  await recorder.record({
    operatorAdminId: adminIdOf(OPERATOR),
    action: ADMIN_ACCOUNT_INVITE_ACTION.name,
    targetIds: [adminIdOf(INVITED_TARGET)],
    reason: '新しい運営者',
    occurredAt: after(MINUTE_MS),
  });
  await recorder.record({
    operatorAdminId: adminIdOf(OPERATOR),
    action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
    targetIds: [adminIdOf(ROLE_CHANGED_TARGET)],
    detail: { fromRole: 'viewer', toRole: 'moderator' },
    occurredAt: after(2 * MINUTE_MS),
  });
  await recorder.record({
    operatorAdminId: adminIdOf(DELETED_OPERATOR),
    action: USER_EMAIL_SEARCH_ACTION.name,
    targetIds: [pseudonymousIdOf(1), pseudonymousIdOf(2)],
    occurredAt: after(3 * MINUTE_MS),
  });
}

beforeEach(async () => {
  await insertAdmin(OPERATOR, { role: 'viewer' });
  sessionToken = (await issueAdminSession(adminIdOf(OPERATOR))).token;
});

describe('auditLogs', () => {
  test('閲覧のみの管理者にも新しい順に返し、操作種別の表示名と、削除済みの操作者には空のニックネームを返す', async () => {
    await recordThreeEntries();

    const response = await searchAuditLogs();

    expect(response.errors).toBeUndefined();
    expect(response.data?.auditLogs).toEqual({
      entries: [
        {
          id: auditLogIdOf(3),
          occurredAt: after(3 * MINUTE_MS).toISOString(),
          operator: { id: adminIdOf(DELETED_OPERATOR), nickname: null },
          action: USER_EMAIL_SEARCH_ACTION.name,
          actionLabel: 'ユーザーのメールアドレス検索',
          targetKind: 'user',
          targetIds: [pseudonymousIdOf(1), pseudonymousIdOf(2)],
          reason: null,
          detail: [],
        },
        {
          id: auditLogIdOf(2),
          occurredAt: after(2 * MINUTE_MS).toISOString(),
          operator: {
            id: adminIdOf(OPERATOR),
            nickname: `管理者${String(OPERATOR)}`,
          },
          action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
          actionLabel: '管理者のロールの変更',
          targetKind: 'admin',
          targetIds: [adminIdOf(ROLE_CHANGED_TARGET)],
          reason: null,
          detail: [
            { key: 'fromRole', value: 'viewer' },
            { key: 'toRole', value: 'moderator' },
          ],
        },
        {
          id: auditLogIdOf(1),
          occurredAt: after(MINUTE_MS).toISOString(),
          operator: {
            id: adminIdOf(OPERATOR),
            nickname: `管理者${String(OPERATOR)}`,
          },
          action: ADMIN_ACCOUNT_INVITE_ACTION.name,
          actionLabel: '管理者の招待',
          targetKind: 'admin',
          targetIds: [adminIdOf(INVITED_TARGET)],
          reason: '新しい運営者',
          detail: [],
        },
      ],
      nextCursor: null,
    });
  });

  test.each([
    {
      label: '操作した管理者',
      filter: { operatorId: adminIdOf(OPERATOR) },
      expected: [auditLogIdOf(2), auditLogIdOf(1)],
    },
    {
      label: '操作種別',
      filter: { action: ADMIN_ACCOUNT_INVITE_ACTION.name },
      expected: [auditLogIdOf(1)],
    },
    {
      label: '対象の識別子',
      filter: { targetId: pseudonymousIdOf(2) },
      expected: [auditLogIdOf(3)],
    },
    {
      label: '期間(開始を含み終了を含まない)',
      filter: {
        occurredFrom: after(2 * MINUTE_MS).toISOString(),
        occurredBefore: after(3 * MINUTE_MS).toISOString(),
      },
      expected: [auditLogIdOf(2)],
    },
    {
      label: '全ての条件',
      filter: {
        operatorId: adminIdOf(OPERATOR),
        action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
        targetId: adminIdOf(ROLE_CHANGED_TARGET),
        occurredFrom: after(MINUTE_MS).toISOString(),
      },
      expected: [auditLogIdOf(2)],
    },
    {
      label: '空の文字列の条件(未指定と同じ)',
      filter: { operatorId: '', action: '', targetId: '' },
      expected: [auditLogIdOf(3), auditLogIdOf(2), auditLogIdOf(1)],
    },
  ])('$labelで絞り込む', async ({ filter, expected }) => {
    await recordThreeEntries();

    expect(await entryIdsOf({ filter })).toEqual(expected);
  });

  test('1ページを50件にし、続きのカーソルで残りを返す', async () => {
    const recorder = createAuditLogRecorder({
      ids: createSequentialAuditLogIds(),
    });
    for (let index = 1; index <= PAGE_SIZE + 1; index += 1) {
      await recorder.record({
        operatorAdminId: adminIdOf(OPERATOR),
        action: ADMIN_ACCOUNT_INVITE_ACTION.name,
        targetIds: [adminIdOf(INVITED_TARGET)],
        occurredAt: after(index * MINUTE_MS),
      });
    }

    const first = await searchAuditLogs();
    const firstPage = first.data?.auditLogs;
    expect(firstPage?.entries).toHaveLength(PAGE_SIZE);
    expect(firstPage?.entries[0]?.id).toBe(auditLogIdOf(PAGE_SIZE + 1));
    expect(firstPage?.nextCursor).toEqual(expect.any(String));

    const second = await searchAuditLogs({ after: firstPage?.nextCursor });

    expect(second.data?.auditLogs).toEqual({
      entries: [expect.objectContaining({ id: auditLogIdOf(1) })],
      nextCursor: null,
    });
  });

  test('不正なカーソルはinvalid_cursorで拒否する', async () => {
    const response = await searchAuditLogs({ after: 'not-a-cursor' });

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });

  test('長すぎる条件の値は欄ごとの詳細で拒否する', async () => {
    const response = await searchAuditLogs({
      filter: { targetId: 'x'.repeat(65) },
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(response.errors?.[0]?.extensions?.details).toEqual([
      expect.objectContaining({ field: 'filter.targetId' }),
    ]);
  });

  test('ログインしていなければ未認証として拒否する', async () => {
    const response = await searchAuditLogs({}, { signedIn: false });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});
