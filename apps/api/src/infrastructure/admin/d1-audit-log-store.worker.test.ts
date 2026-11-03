import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  ADMIN_ACCOUNT_DELETE_ACTION,
  ADMIN_ACCOUNT_INVITE_ACTION,
  ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
  USER_EMAIL_SEARCH_ACTION,
} from '../../../common-lib/admin/audit-actions/admin-foundation.ts';
import { createDatabase } from '../../../db/client.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import {
  AUDIT_LOG_PAGE_SIZE,
  type AuditLogFilter,
  type AuditLogSearchResult,
} from '../../application/admin/audit-log-reader.ts';
import type { AuditLogRecorder } from '../../application/admin/audit-log-recorder.ts';
import type { AuditEntryInput } from '../../domain/admin/audit-entry.ts';
import { D1AuditLogStore } from './d1-audit-log-store.ts';
import {
  adminIdOf,
  after,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  db,
  pseudonymousIdOf,
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from './testing/admin-store-fixtures.ts';

const MAX_BOUND_PARAMETERS = 100;

const MINUTE = 60_000;

const OPERATOR = 1;

const OTHER_OPERATOR = 2;

const PAGE = { limit: AUDIT_LOG_PAGE_SIZE } as const;

let recorder: AuditLogRecorder;

function createStore(): D1AuditLogStore {
  return new D1AuditLogStore(db);
}

function inviteOf(
  targetIndex: number,
  overrides: Partial<AuditEntryInput> = {},
): AuditEntryInput {
  return {
    operatorAdminId: adminIdOf(OPERATOR),
    action: ADMIN_ACCOUNT_INVITE_ACTION.name,
    targetIds: [adminIdOf(targetIndex)],
    occurredAt: after(0),
    ...overrides,
  };
}

function emailSearchOf(
  targetIndexes: readonly number[],
  overrides: Partial<AuditEntryInput> = {},
): AuditEntryInput {
  return {
    operatorAdminId: adminIdOf(OPERATOR),
    action: USER_EMAIL_SEARCH_ACTION.name,
    targetIds: targetIndexes.map(pseudonymousIdOf),
    occurredAt: after(0),
    ...overrides,
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

async function recordAll(entries: readonly AuditEntryInput[]): Promise<void> {
  for (const entry of entries) {
    await recorder.record(entry);
  }
}

function idsOf(result: AuditLogSearchResult): readonly string[] {
  return result.entries.map((entry) => entry.id);
}

function placeholderCount(query: string): number {
  return query.match(/\?/gu)?.length ?? 0;
}

beforeEach(async () => {
  await clearAdminTables();
  recorder = createAuditLogRecorder({ ids: createSequentialAuditLogIds(1) });
});

describe('D1AuditLogStore.insert', () => {
  test('準備の値を単独の一括の書き込みで保存し、検索で同じ内容を読める', async () => {
    const recording = createBatchRecordingD1(env.DB);
    const store = new D1AuditLogStore(createDatabase(recording.d1));
    const entry = createAuditLogRecorder().prepare({
      operatorAdminId: adminIdOf(OPERATOR),
      action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
      targetIds: [adminIdOf(5)],
      reason: '  担当の変更  ',
      detail: { fromRole: 'viewer', toRole: 'moderator' },
      occurredAt: after(MINUTE),
    });

    await store.insert(entry);

    expect(recording.batches).toHaveLength(1);
    expect(recording.statementsOutsideBatches()).toEqual([]);
    await expect(createStore().search({}, PAGE)).resolves.toEqual({
      entries: [
        {
          id: entry.id,
          occurredAt: after(MINUTE),
          operatorAdminId: adminIdOf(OPERATOR),
          action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
          targetKind: 'admin',
          targetIds: [adminIdOf(5)],
          reason: '担当の変更',
          detail: { fromRole: 'viewer', toRole: 'moderator' },
        },
      ],
      nextCursor: null,
    });
  });
});

describe('D1AuditLogStore.search', () => {
  test('日時とIDの降順で1ページ50件を返し、カーソルで続きのページを返す', async () => {
    await recordAll(
      range(1, 52).map((index) =>
        inviteOf(index, { occurredAt: after(Math.floor(index / 2) * MINUTE) }),
      ),
    );
    const store = createStore();
    const expected = range(1, 52)
      .map((index) => ({
        id: auditLogIdOf(index),
        at: Math.floor(index / 2),
      }))
      .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
      .map(({ id }) => id);

    const first = await store.search({}, PAGE);
    const second = await store.search(
      {},
      { ...PAGE, after: first.nextCursor ?? undefined },
    );

    expect(idsOf(first)).toEqual(expected.slice(0, 50));
    expect(first.nextCursor).not.toBeNull();
    expect(idsOf(second)).toEqual(expected.slice(50));
    expect(second.nextCursor).toBeNull();
  });

  test('ちょうど50件のときは続きのページのカーソルを返さない', async () => {
    await recordAll(range(1, 50).map((index) => inviteOf(index)));

    const result = await createStore().search({}, PAGE);

    expect(result.entries).toHaveLength(50);
    expect(result.nextCursor).toBeNull();
  });

  test('カーソルは日時のミリ秒とIDをbase64urlにしたものである', async () => {
    await recordAll(
      range(1, 51).map((index) => inviteOf(index, { occurredAt: after(0) })),
    );

    const result = await createStore().search({}, PAGE);

    const decoded = new TextDecoder().decode(
      Uint8Array.fromBase64(result.nextCursor ?? '', { alphabet: 'base64url' }),
    );
    expect(decoded).toBe(`${String(after(0).getTime())}:${auditLogIdOf(2)}`);
  });

  describe('絞り込み', () => {
    beforeEach(async () => {
      await recordAll([
        inviteOf(10, { occurredAt: after(0) }),
        inviteOf(11, {
          operatorAdminId: adminIdOf(OTHER_OPERATOR),
          occurredAt: after(MINUTE),
        }),
        {
          operatorAdminId: adminIdOf(OPERATOR),
          action: ADMIN_ACCOUNT_DELETE_ACTION.name,
          targetIds: [adminIdOf(10)],
          occurredAt: after(2 * MINUTE),
        },
        emailSearchOf([1, 2, 3], { occurredAt: after(3 * MINUTE) }),
        emailSearchOf([], {
          operatorAdminId: adminIdOf(OTHER_OPERATOR),
          occurredAt: after(4 * MINUTE),
        }),
        // 利用者の仮名化IDと同じ値を管理者の対象として記録し、対象の識別子の絞り込みが種類を問わないことを確かめる
        inviteOf(0, {
          targetIds: [pseudonymousIdOf(2)],
          occurredAt: after(5 * MINUTE),
        }),
      ]);
    });

    test.each<{
      readonly name: string;
      readonly filter: AuditLogFilter;
      readonly expected: readonly number[];
    }>([
      { name: '条件なし', filter: {}, expected: [6, 5, 4, 3, 2, 1] },
      {
        name: '操作した管理者',
        filter: { operatorAdminId: adminIdOf(OTHER_OPERATOR) },
        expected: [5, 2],
      },
      {
        name: '操作種別',
        filter: { action: ADMIN_ACCOUNT_INVITE_ACTION.name },
        expected: [6, 2, 1],
      },
      {
        name: '対象の識別子',
        filter: { targetId: adminIdOf(10) },
        expected: [3, 1],
      },
      {
        name: '複数の対象のうちの1つの識別子',
        filter: { targetId: pseudonymousIdOf(2) },
        expected: [6, 4],
      },
      {
        name: '期間の開始(その日時を含む)',
        filter: { occurredFrom: after(3 * MINUTE) },
        expected: [6, 5, 4],
      },
      {
        name: '期間の終了(その日時を含まない)',
        filter: { occurredBefore: after(2 * MINUTE) },
        expected: [2, 1],
      },
      {
        name: 'すべての条件',
        filter: {
          operatorAdminId: adminIdOf(OPERATOR),
          action: USER_EMAIL_SEARCH_ACTION.name,
          targetId: pseudonymousIdOf(3),
          occurredFrom: after(MINUTE),
          occurredBefore: after(4 * MINUTE),
        },
        expected: [4],
      },
      {
        name: '該当なし',
        filter: { targetId: adminIdOf(99) },
        expected: [],
      },
    ])('$nameで絞り込む', async ({ filter, expected }) => {
      const result = await createStore().search(filter, PAGE);

      expect(idsOf(result)).toEqual(expected.map(auditLogIdOf));
      expect(result.nextCursor).toBeNull();
    });

    test('対象の識別子で絞り込んでも、記録の対象はすべて記録の順に返す', async () => {
      const result = await createStore().search(
        { targetId: pseudonymousIdOf(3) },
        PAGE,
      );

      expect(result.entries).toEqual([
        expect.objectContaining({
          id: auditLogIdOf(4),
          targetKind: 'user',
          targetIds: [1, 2, 3].map(pseudonymousIdOf),
          reason: null,
          detail: {},
        }),
      ]);
    });

    test('対象の無い記録は対象の種類をnull、対象を空で返す', async () => {
      const result = await createStore().search(
        { operatorAdminId: adminIdOf(OTHER_OPERATOR) },
        PAGE,
      );

      expect(result.entries[0]).toEqual(
        expect.objectContaining({ targetKind: null, targetIds: [] }),
      );
    });

    test('絞り込みを続きのページにも適用する', async () => {
      await recordAll(
        range(100, 152).map((index) =>
          inviteOf(index, {
            operatorAdminId: adminIdOf(OTHER_OPERATOR),
            occurredAt: after(10 * MINUTE),
          }),
        ),
      );
      const store = createStore();
      const filter = { operatorAdminId: adminIdOf(OTHER_OPERATOR) };

      const first = await store.search(filter, PAGE);
      const second = await store.search(filter, {
        ...PAGE,
        after: first.nextCursor ?? undefined,
      });

      expect(first.entries).toHaveLength(50);
      expect(idsOf(second)).toEqual(
        [9, 8, 7, 5, 2].map((index) => auditLogIdOf(index)),
      );
      expect(second.nextCursor).toBeNull();
    });
  });

  test.each([
    { name: 'base64urlでない', cursor: '***' },
    {
      name: 'パディング付き',
      cursor: new TextEncoder()
        .encode(`1:${auditLogIdOf(1)}`)
        .toBase64({ alphabet: 'base64url' }),
    },
    {
      name: '形式の違う中身',
      cursor: new TextEncoder()
        .encode('not-a-cursor')
        .toBase64({ alphabet: 'base64url', omitPadding: true }),
    },
    {
      name: 'IDが小文字',
      cursor: new TextEncoder()
        .encode(`1:${auditLogIdOf(1).toLowerCase()}`)
        .toBase64({ alphabet: 'base64url', omitPadding: true }),
    },
    {
      name: 'UTF-8として読めない中身',
      cursor: new Uint8Array([0xff, 0xfe]).toBase64({
        alphabet: 'base64url',
        omitPadding: true,
      }),
    },
  ])('$nameのカーソルはinvalid_cursorで拒否する', async ({ cursor }) => {
    const error: unknown = await createStore()
      .search({}, { ...PAGE, after: cursor })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'invalid_cursor',
    });
  });
});

describe('D1AuditLogStore.latestFor', () => {
  beforeEach(async () => {
    await recordAll([
      inviteOf(10, { occurredAt: after(MINUTE) }),
      inviteOf(10, { occurredAt: after(3 * MINUTE) }),
      inviteOf(10, { occurredAt: after(2 * MINUTE) }),
      {
        operatorAdminId: adminIdOf(OPERATOR),
        action: ADMIN_ACCOUNT_DELETE_ACTION.name,
        targetIds: [adminIdOf(10)],
        occurredAt: after(9 * MINUTE),
      },
      emailSearchOf([1], { occurredAt: after(4 * MINUTE) }),
    ]);
  });

  test('操作種別・対象の種類・対象の識別子が一致する最新の日時を返す', async () => {
    await expect(
      createStore().latestFor({
        action: ADMIN_ACCOUNT_INVITE_ACTION.name,
        targetKind: 'admin',
        targetId: adminIdOf(10),
      }),
    ).resolves.toEqual(after(3 * MINUTE));
  });

  test.each([
    {
      name: '記録の無い対象',
      query: {
        action: ADMIN_ACCOUNT_INVITE_ACTION.name,
        targetKind: 'admin',
        targetId: adminIdOf(11),
      },
    },
    {
      name: '対象の種類が異なる',
      query: {
        action: ADMIN_ACCOUNT_INVITE_ACTION.name,
        targetKind: 'user',
        targetId: adminIdOf(10),
      },
    },
    {
      name: '操作種別が異なる',
      query: {
        action: USER_EMAIL_SEARCH_ACTION.name,
        targetKind: 'user',
        targetId: adminIdOf(10),
      },
    },
  ] as const)('$nameはundefinedを返す', async ({ query }) => {
    await expect(createStore().latestFor(query)).resolves.toBeUndefined();
  });
});

describe('D1AuditLogStore.latestForMany', () => {
  test('対象ごとの最新の日時を返し、記録の無い対象を含めない', async () => {
    await recordAll([
      emailSearchOf([1, 2], { occurredAt: after(MINUTE) }),
      emailSearchOf([2, 3], { occurredAt: after(3 * MINUTE) }),
      emailSearchOf([1], { occurredAt: after(2 * MINUTE) }),
    ]);

    const latest = await createStore().latestForMany({
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetKind: 'user',
      targetIds: [1, 2, 3, 4].map(pseudonymousIdOf),
    });

    expect(latest).toEqual(
      new Map([
        [pseudonymousIdOf(1), after(2 * MINUTE)],
        [pseudonymousIdOf(2), after(3 * MINUTE)],
        [pseudonymousIdOf(3), after(3 * MINUTE)],
      ]),
    );
  });

  test('操作種別と対象の種類で絞る', async () => {
    await recordAll([
      emailSearchOf([1], { occurredAt: after(MINUTE) }),
      inviteOf(0, {
        targetIds: [pseudonymousIdOf(1)],
        occurredAt: after(5 * MINUTE),
      }),
      inviteOf(0, {
        targetIds: [pseudonymousIdOf(2)],
        occurredAt: after(6 * MINUTE),
      }),
    ]);
    const store = createStore();
    const targetIds = [pseudonymousIdOf(1), pseudonymousIdOf(2)];

    const users = await store.latestForMany({
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetKind: 'user',
      targetIds,
    });
    const invitedAdmins = await store.latestForMany({
      action: ADMIN_ACCOUNT_INVITE_ACTION.name,
      targetKind: 'admin',
      targetIds,
    });
    const mismatchedKind = await store.latestForMany({
      action: ADMIN_ACCOUNT_INVITE_ACTION.name,
      targetKind: 'user',
      targetIds,
    });

    expect(users).toEqual(new Map([[pseudonymousIdOf(1), after(MINUTE)]]));
    expect(invitedAdmins).toEqual(
      new Map([
        [pseudonymousIdOf(1), after(5 * MINUTE)],
        [pseudonymousIdOf(2), after(6 * MINUTE)],
      ]),
    );
    expect(mismatchedKind).toEqual(new Map());
  });

  test('90件を超える入力は上限内の複数の問い合わせに分け、結果を1つにまとめる', async () => {
    await recordAll([
      emailSearchOf(range(1, 100), { occurredAt: after(MINUTE) }),
      emailSearchOf(range(1, 50), { occurredAt: after(2 * MINUTE) }),
    ]);
    const recording = createBatchRecordingD1(env.DB);
    const store = new D1AuditLogStore(createDatabase(recording.d1));

    const latest = await store.latestForMany({
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetKind: 'user',
      targetIds: range(1, 120).map(pseudonymousIdOf),
    });

    const queries = recording.statementsOutsideBatches();
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(placeholderCount(query)).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS);
    }
    expect(latest).toEqual(
      new Map([
        ...range(1, 50).map(
          (index) => [pseudonymousIdOf(index), after(2 * MINUTE)] as const,
        ),
        ...range(51, 100).map(
          (index) => [pseudonymousIdOf(index), after(MINUTE)] as const,
        ),
      ]),
    );
  });

  test('重複したIDは1件として問い合わせる', async () => {
    await recordAll([emailSearchOf([1], { occurredAt: after(MINUTE) })]);
    const recording = createBatchRecordingD1(env.DB);
    const store = new D1AuditLogStore(createDatabase(recording.d1));

    const latest = await store.latestForMany({
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetKind: 'user',
      targetIds: [
        ...Array.from({ length: 95 }, () => pseudonymousIdOf(1)),
        pseudonymousIdOf(2),
      ],
    });

    expect(recording.statementsOutsideBatches()).toHaveLength(1);
    expect(latest).toEqual(new Map([[pseudonymousIdOf(1), after(MINUTE)]]));
  });

  test('空の入力は問い合わせずに空の結果を返す', async () => {
    const recording = createBatchRecordingD1(env.DB);
    const store = new D1AuditLogStore(createDatabase(recording.d1));

    const latest = await store.latestForMany({
      action: USER_EMAIL_SEARCH_ACTION.name,
      targetKind: 'user',
      targetIds: [],
    });

    expect(latest).toEqual(new Map());
    expect(recording.statementsOutsideBatches()).toEqual([]);
  });
});

describe('D1AuditLogStore.deleteOccurredUntil', () => {
  const CUTOFF = after(3 * MINUTE);

  async function recordAroundCutoff(): Promise<void> {
    await recordAll([
      inviteOf(11, { occurredAt: after(2 * MINUTE) }),
      emailSearchOf([1, 2], { occurredAt: after(MINUTE) }),
      inviteOf(13, { occurredAt: CUTOFF }),
      inviteOf(14, { occurredAt: new Date(CUTOFF.getTime() + 1) }),
    ]);
  }

  test('基準の日時以前に記録された監査ログを記録の古い順に上限件数まで、対象の行とともに消し、消したログの件数を返す', async () => {
    await recordAroundCutoff();
    const store = createStore();

    expect(await store.deleteOccurredUntil(CUTOFF, 1)).toBe(1);
    expect((await readAuditLogSummaries()).map(({ id }) => id)).toEqual([
      auditLogIdOf(1),
      auditLogIdOf(3),
      auditLogIdOf(4),
    ]);
    expect(await readAuditLogTargetIds()).toEqual([
      adminIdOf(11),
      adminIdOf(13),
      adminIdOf(14),
    ]);

    expect(await store.deleteOccurredUntil(CUTOFF, 5)).toBe(2);
    expect(await store.deleteOccurredUntil(CUTOFF, 5)).toBe(0);
    expect((await readAuditLogSummaries()).map(({ id }) => id)).toEqual([
      auditLogIdOf(4),
    ]);
    expect(await readAuditLogTargetIds()).toEqual([adminIdOf(14)]);
  });

  test('対象の行の削除とログの削除を、この順で1つの一括の書き込みにする', async () => {
    await recordAroundCutoff();
    const recording = createBatchRecordingD1(env.DB);
    const store = new D1AuditLogStore(createDatabase(recording.d1));

    await store.deleteOccurredUntil(CUTOFF, 500);

    expect(recording.statementsOutsideBatches()).toEqual([]);
    expect(recording.batches).toHaveLength(1);
    const [targetsDeletion, logsDeletion] = recording.batches[0] ?? [];
    expect(recording.batches[0]).toHaveLength(2);
    expect(targetsDeletion).toMatch(/^delete from "admin_audit_log_targets"/u);
    expect(logsDeletion).toMatch(/^delete from "admin_audit_logs"/u);
  });
});
