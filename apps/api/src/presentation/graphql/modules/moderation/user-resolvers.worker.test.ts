import { describe, expect, test } from 'vitest';

import {
  after,
  emailOf,
  insertUser,
  T0,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { readModerationRows } from '../../../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import {
  adminIdOf,
  pseudonymousIdOf,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';
import { readModerationAuditLogs } from '../../../../infrastructure/moderation/testing/moderation-write-fixtures.ts';
import {
  asModerationAdmin,
  codesOf,
  conflictAccountTransitions,
  detailsOf,
  fetchAdminUsers,
  insertAvatar,
  installModerationUserGraphQLTest,
  MODERATION_ADMINS,
  MODERATION_TEST_NOW,
  readUserState,
  suspendUser,
  unsuspendUser,
  withdrawUserByAdministrator,
} from '../../../../../test/support/moderation-user-graphql-operations.ts';

installModerationUserGraphQLTest();

const REASON = '規約違反の投稿を繰り返したため';

const NOW_TEXT = MODERATION_TEST_NOW.toISOString();

const USER_NOT_FOUND_MESSAGE = '利用者が見つかりません。';

const INVALID_CURSOR_MESSAGE = 'ページの位置の指定が正しくありません。';

const CONFLICT_MESSAGE =
  '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。';

const asViewer = () => asModerationAdmin(MODERATION_ADMINS.viewer);
const asModerator = () => asModerationAdmin(MODERATION_ADMINS.moderator);
const asSuperAdmin = () => asModerationAdmin(MODERATION_ADMINS.superAdmin);

const ACTIVE_STATE = Object.freeze({
  status: 'active',
  suspendedAt: null,
  deletedAt: null,
});

// 監査ログの利用者の対象は仮名化ID(UUID)だけを受け付ける
const insertTargetUser = (
  index: number,
  columns: Parameters<typeof insertUser>[1] = {},
): Promise<void> =>
  insertUser(index, { pseudonymousId: pseudonymousIdOf(index), ...columns });

// 登録の新しい順に利用者3・2・1と並ぶよう、登録日時をずらす
async function arrangeUsers(): Promise<void> {
  await insertTargetUser(1, { createdAt: after(1_000) });
  await insertTargetUser(2, {
    createdAt: after(2_000),
    emailVerifiedAt: T0,
    disposableEmailStatus: 'disposable',
  });
  await insertTargetUser(3, { createdAt: after(3_000), emailVerifiedAt: T0 });
}

describe('adminUsers', () => {
  test('閲覧のみの管理者に、登録の新しい順の利用者を画像・登録日時・使い捨ての判定・停止状態と停止の理由とともに返し、メールアドレスを返さない', async () => {
    await arrangeUsers();
    await insertFile(1, { ownerId: userIdOf(2) });
    await insertReason(1, 'auto');
    await insertAvatar(2, fileIdOf(1));
    await suspendUser({ id: userIdOf(3), reason: REASON }, asModerator());

    const response = await fetchAdminUsers({ first: 10 }, asViewer());

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminUsers).toStrictEqual({
      nodes: [
        {
          id: userIdOf(3),
          handle: 'user3',
          nickname: '利用者3',
          avatar: null,
          registeredAt: after(3_000).toISOString(),
          disposableEmail: 'UNDETERMINED',
          status: 'SUSPENDED',
          suspendedAt: NOW_TEXT,
          latestSuspension: { reason: REASON, occurredAt: NOW_TEXT },
        },
        {
          id: userIdOf(2),
          handle: 'user2',
          nickname: '利用者2',
          avatar: {
            id: fileIdOf(1),
            path: `/_bff/files/${fileIdOf(1)}`,
            image: {
              id: fileIdOf(1),
              objectKey: null,
              fallbackFormat: 'PNG',
              width: 640,
              height: 480,
            },
            quarantined: true,
            quarantineReasons: ['AUTO'],
          },
          registeredAt: after(2_000).toISOString(),
          disposableEmail: 'DISPOSABLE',
          status: 'ACTIVE',
          suspendedAt: null,
          latestSuspension: null,
        },
        {
          id: userIdOf(1),
          handle: 'user1',
          nickname: '利用者1',
          avatar: null,
          registeredAt: after(1_000).toISOString(),
          disposableEmail: 'UNVERIFIED',
          status: 'ACTIVE',
          suspendedAt: null,
          latestSuspension: null,
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(JSON.stringify(response.data)).not.toContain('mail.example');
  });

  test('公開中のプロフィール画像には変換配信のオブジェクトキーを返す', async () => {
    await insertTargetUser(1);
    await insertFile(1, { ownerId: userIdOf(1), contentType: 'image/jpeg' });
    await insertAvatar(1, fileIdOf(1));

    const response = await fetchAdminUsers({ first: 10 }, asViewer());

    expect(response.data?.adminUsers?.nodes[0]?.avatar).toStrictEqual({
      id: fileIdOf(1),
      path: `/_bff/files/${fileIdOf(1)}`,
      image: {
        id: fileIdOf(1),
        objectKey: objectKeyOf(1),
        fallbackFormat: 'JPG',
        width: 640,
        height: 480,
      },
      quarantined: false,
      quarantineReasons: [],
    });
  });

  test('件数で区切り、上流の続きの位置をそのまま中継して次のページを返す', async () => {
    await arrangeUsers();

    const first = await fetchAdminUsers({ first: 2 }, asViewer());
    const endCursor = first.data?.adminUsers?.pageInfo.endCursor ?? null;
    const second = await fetchAdminUsers(
      { first: 2, after: endCursor },
      asViewer(),
    );

    expect(first.data?.adminUsers?.nodes.map(({ id }) => id)).toStrictEqual([
      userIdOf(3),
      userIdOf(2),
    ]);
    expect(first.data?.adminUsers?.pageInfo.hasNextPage).toBe(true);
    expect(endCursor).toEqual(expect.any(String));
    expect(second.data?.adminUsers).toStrictEqual({
      nodes: [expect.objectContaining({ id: userIdOf(1) })],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test('ハンドル・ニックネームの部分一致と停止状態を組み合わせて絞り込む', async () => {
    await arrangeUsers();
    await insertTargetUser(4, { handle: 'other', nickname: '別人' });
    await suspendUser({ id: userIdOf(1), reason: REASON }, asModerator());

    const byHandle = await fetchAdminUsers(
      { filter: { handle: 'USER', status: 'ACTIVE' }, first: 10 },
      asViewer(),
    );
    const byNickname = await fetchAdminUsers(
      { filter: { nickname: '別', status: null }, first: 10 },
      asViewer(),
    );

    expect(byHandle.data?.adminUsers?.nodes.map(({ id }) => id)).toStrictEqual([
      userIdOf(3),
      userIdOf(2),
    ]);
    expect(
      byNickname.data?.adminUsers?.nodes.map(({ id }) => id),
    ).toStrictEqual([userIdOf(4)]);
  });

  test('メールアドレスの完全一致で絞り込み、表示した利用者の仮名化IDで検索を監査ログに記録する', async () => {
    await arrangeUsers();

    const response = await fetchAdminUsers(
      { filter: { email: emailOf(2).toUpperCase() }, first: 10 },
      asViewer(),
    );

    expect(response.data?.adminUsers?.nodes.map(({ id }) => id)).toStrictEqual([
      userIdOf(2),
    ]);
    expect(await readModerationAuditLogs()).toStrictEqual([
      expect.objectContaining({
        operatorAdminId: adminIdOf(MODERATION_ADMINS.viewer),
        action: 'user.email-search',
        targets: [{ targetKind: 'user', targetId: pseudonymousIdOf(2) }],
      }),
    ]);
    expect(JSON.stringify(await readModerationAuditLogs())).not.toContain(
      emailOf(2),
    );
  });

  test('該当する利用者がいなければ空の一覧を返す', async () => {
    await arrangeUsers();

    const response = await fetchAdminUsers(
      { filter: { handle: 'nobody' }, first: 10 },
      asViewer(),
    );

    expect(response.data?.adminUsers).toStrictEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test('不正な位置は上流のinvalid_cursorと文言を変換せずに返す', async () => {
    await arrangeUsers();

    const response = await fetchAdminUsers(
      { first: 10, after: 'not-a-cursor' },
      asViewer(),
    );

    expect(codesOf(response)).toStrictEqual(['invalid_cursor']);
    expect(response.errors?.[0]?.message).toBe(INVALID_CURSOR_MESSAGE);
  });

  test('件数が1〜50の範囲外ならvalidation_errorで拒否する', async () => {
    const response = await fetchAdminUsers({ first: 51 }, asViewer());

    expect(codesOf(response)).toStrictEqual(['validation_error']);
    expect(detailsOf(response).map(({ field }) => field)).toStrictEqual([
      'first',
    ]);
  });

  test('利用者側の呼び出し元はforbidden、管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    await arrangeUsers();

    const client = await fetchAdminUsers({ first: 10 });
    const anonymous = await fetchAdminUsers({ first: 10 }, { caller: 'admin' });

    expect(codesOf(client)).toStrictEqual(['forbidden']);
    expect(codesOf(anonymous)).toStrictEqual(['unauthenticated']);
  });

  test('利用者側の呼び出し元は入力の検証より前にforbiddenで拒否する', async () => {
    const response = await fetchAdminUsers({ first: 0 });

    expect(codesOf(response)).toStrictEqual(['forbidden']);
  });
});

describe('suspendUser・unsuspendUser', () => {
  test('モデレーターが停止すると、状態を変えて変化ありを返し、措置の記録と監査ログを残す', async () => {
    await insertTargetUser(1);

    const response = await suspendUser(
      { id: userIdOf(1), reason: `  ${REASON}  ` },
      asModerator(),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.suspendUser).toStrictEqual({ changed: true });
    expect(await readUserState(1)).toStrictEqual({
      status: 'suspended',
      suspendedAt: MODERATION_TEST_NOW,
      deletedAt: null,
    });
    expect(await readModerationRows()).toStrictEqual([
      expect.objectContaining({
        action: 'user.suspend',
        targetId: userIdOf(1),
        operatorAdminId: adminIdOf(MODERATION_ADMINS.moderator),
        reason: REASON,
        occurredAt: MODERATION_TEST_NOW,
      }),
    ]);
    expect(await readModerationAuditLogs()).toStrictEqual([
      expect.objectContaining({
        operatorAdminId: adminIdOf(MODERATION_ADMINS.moderator),
        action: 'user.suspend',
        reason: REASON,
        targets: [{ targetKind: 'user', targetId: pseudonymousIdOf(1) }],
      }),
    ]);
  });

  test('既に停止中の利用者の停止は変化なしを返し、記録を増やさない', async () => {
    await insertTargetUser(1);
    await suspendUser({ id: userIdOf(1), reason: REASON }, asModerator());

    const response = await suspendUser(
      { id: userIdOf(1), reason: REASON },
      asModerator(),
    );

    expect(response.data?.suspendUser).toStrictEqual({ changed: false });
    expect(await readModerationRows()).toHaveLength(1);
  });

  test('最上位管理者が停止解除すると、利用中に戻して変化ありを返し、利用中の利用者の停止解除は変化なしを返す', async () => {
    await insertTargetUser(1);
    await insertTargetUser(2);
    await suspendUser({ id: userIdOf(1), reason: REASON }, asModerator());

    const changed = await unsuspendUser(
      { id: userIdOf(1), reason: '誤った停止だったため' },
      asSuperAdmin(),
    );
    const unchanged = await unsuspendUser(
      { id: userIdOf(2), reason: '誤った停止だったため' },
      asSuperAdmin(),
    );

    expect(changed.data?.unsuspendUser).toStrictEqual({ changed: true });
    expect(unchanged.data?.unsuspendUser).toStrictEqual({ changed: false });
    expect(await readUserState(1)).toStrictEqual(ACTIVE_STATE);
    // 同じ時刻に採番した記録のIDは順にならないため、措置の種類で並べて比べる
    expect(
      (await readModerationRows())
        .map(({ action, operatorAdminId }) => [action, operatorAdminId])
        .toSorted(([left = ''], [right = '']) => left.localeCompare(right)),
    ).toStrictEqual([
      ['user.suspend', adminIdOf(MODERATION_ADMINS.moderator)],
      ['user.unsuspend', adminIdOf(MODERATION_ADMINS.superAdmin)],
    ]);
  });

  test.each([
    ['停止', suspendUser],
    ['停止解除', unsuspendUser],
  ])(
    '閲覧のみの管理者の%sはforbiddenで拒否し、何も書かない',
    async (_, call) => {
      await insertTargetUser(1);

      const response = await call(
        { id: userIdOf(1), reason: REASON },
        asViewer(),
      );

      expect(codesOf(response)).toStrictEqual(['forbidden']);
      expect(await readUserState(1)).toStrictEqual(ACTIVE_STATE);
      expect(await readModerationRows()).toStrictEqual([]);
      expect(await readModerationAuditLogs()).toStrictEqual([]);
    },
  );

  test.each([
    ['停止', suspendUser],
    ['停止解除', unsuspendUser],
  ])(
    '利用者側の呼び出し元の%sはforbidden、管理者のセッションが無ければunauthenticatedで拒否する',
    async (_, call) => {
      await insertTargetUser(1);

      const client = await call({ id: userIdOf(1), reason: REASON });
      const anonymous = await call(
        { id: userIdOf(1), reason: REASON },
        { caller: 'admin' },
      );

      expect(codesOf(client)).toStrictEqual(['forbidden']);
      expect(codesOf(anonymous)).toStrictEqual(['unauthenticated']);
      expect(await readUserState(1)).toStrictEqual(ACTIVE_STATE);
    },
  );

  test.each([
    ['空白だけ', ' \n\t ', 'required', '理由を入力してください。'],
    [
      '501文字',
      'あ'.repeat(501),
      'custom',
      '理由は500文字以内で入力してください。',
    ],
  ])(
    '理由が%sならvalidation_errorで拒否し、何も書かない',
    async (_, reason, code, message) => {
      await insertTargetUser(1);

      const response = await suspendUser(
        { id: userIdOf(1), reason },
        asModerator(),
      );

      expect(codesOf(response)).toStrictEqual(['validation_error']);
      expect(detailsOf(response)).toStrictEqual([
        { field: 'reason', code, message },
      ]);
      expect(await readUserState(1)).toStrictEqual(ACTIVE_STATE);
      expect(await readModerationRows()).toStrictEqual([]);
    },
  );

  test('存在しない・退会済みの利用者はuser_not_found、形式の違うIDは同じ文言のvalidation_errorで拒否する', async () => {
    await insertTargetUser(1, { deletedAt: after(1) });

    const withdrawn = await suspendUser(
      { id: userIdOf(1), reason: REASON },
      asModerator(),
    );
    const missing = await unsuspendUser(
      { id: userIdOf(9), reason: REASON },
      asModerator(),
    );
    const malformed = await suspendUser(
      { id: userIdOf(1).toLowerCase(), reason: REASON },
      asModerator(),
    );

    for (const response of [withdrawn, missing]) {
      expect(codesOf(response)).toStrictEqual(['user_not_found']);
      expect(response.errors?.[0]?.message).toBe(USER_NOT_FOUND_MESSAGE);
    }
    expect(codesOf(malformed)).toStrictEqual(['validation_error']);
    expect(detailsOf(malformed)).toStrictEqual([
      {
        field: 'id',
        code: 'invalid_format',
        message: USER_NOT_FOUND_MESSAGE,
      },
    ]);
  });

  test('確定が他の操作と競合したら管理画面の文言のaccount_state_conflictで拒否し、何も書かない', async () => {
    await insertTargetUser(1);
    conflictAccountTransitions();

    const response = await suspendUser(
      { id: userIdOf(1), reason: REASON },
      asModerator(),
    );

    expect(codesOf(response)).toStrictEqual(['account_state_conflict']);
    expect(response.errors?.[0]?.message).toBe(CONFLICT_MESSAGE);
    expect(await readModerationRows()).toStrictEqual([]);
  });
});

describe('withdrawUserByAdministrator', () => {
  const REQUEST_REASON = '本人から問い合わせのメールで退会の依頼を受けたため';

  test('最上位管理者が停止中の利用者を退会させ、変化ありを返して措置の記録と監査ログを残す', async () => {
    await insertTargetUser(1);
    await suspendUser({ id: userIdOf(1), reason: REASON }, asModerator());

    const response = await withdrawUserByAdministrator(
      { userId: userIdOf(1), reason: REQUEST_REASON },
      asSuperAdmin(),
    );

    expect(response.data?.withdrawUserByAdministrator).toStrictEqual({
      changed: true,
    });
    expect((await readUserState(1))?.deletedAt).toStrictEqual(
      MODERATION_TEST_NOW,
    );
    expect(await readModerationRows()).toContainEqual(
      expect.objectContaining({
        action: 'user.administrative-withdraw',
        targetId: userIdOf(1),
        operatorAdminId: adminIdOf(MODERATION_ADMINS.superAdmin),
        reason: REQUEST_REASON,
        noticeStatus: 'none',
      }),
    );
    expect(await readModerationAuditLogs()).toContainEqual(
      expect.objectContaining({
        operatorAdminId: adminIdOf(MODERATION_ADMINS.superAdmin),
        action: 'user.administrative-withdraw',
        targets: [{ targetKind: 'user', targetId: pseudonymousIdOf(1) }],
      }),
    );
  });

  test.each([
    ['モデレーター', MODERATION_ADMINS.moderator],
    ['閲覧のみの管理者', MODERATION_ADMINS.viewer],
  ])('%sの代理の退会はforbiddenで拒否し、何も書かない', async (_, admin) => {
    await insertTargetUser(1);

    const response = await withdrawUserByAdministrator(
      { userId: userIdOf(1), reason: REQUEST_REASON },
      asModerationAdmin(admin),
    );

    expect(codesOf(response)).toStrictEqual(['forbidden']);
    expect(await readUserState(1)).toStrictEqual(ACTIVE_STATE);
    expect(await readModerationRows()).toStrictEqual([]);
    expect(await readModerationAuditLogs()).toStrictEqual([]);
  });

  test('利用者側の呼び出し元はforbidden、管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    await insertTargetUser(1);

    const client = await withdrawUserByAdministrator({
      userId: userIdOf(1),
      reason: REQUEST_REASON,
    });
    const anonymous = await withdrawUserByAdministrator(
      { userId: userIdOf(1), reason: REQUEST_REASON },
      { caller: 'admin' },
    );

    expect(codesOf(client)).toStrictEqual(['forbidden']);
    expect(codesOf(anonymous)).toStrictEqual(['unauthenticated']);
    expect(await readUserState(1)).toStrictEqual(ACTIVE_STATE);
  });

  test('存在しない・退会済みの利用者はuser_not_foundで拒否する', async () => {
    await insertTargetUser(1, { deletedAt: after(1) });

    const withdrawn = await withdrawUserByAdministrator(
      { userId: userIdOf(1), reason: REQUEST_REASON },
      asSuperAdmin(),
    );
    const missing = await withdrawUserByAdministrator(
      { userId: userIdOf(9), reason: REQUEST_REASON },
      asSuperAdmin(),
    );

    for (const response of [withdrawn, missing]) {
      expect(codesOf(response)).toStrictEqual(['user_not_found']);
      expect(response.errors?.[0]?.message).toBe(USER_NOT_FOUND_MESSAGE);
    }
    expect(await readModerationRows()).toStrictEqual([]);
  });

  test('理由が空ならvalidation_errorの詳細の欄を入力の経路にして拒否する', async () => {
    await insertTargetUser(1);

    const empty = await withdrawUserByAdministrator(
      { userId: userIdOf(1), reason: '' },
      asSuperAdmin(),
    );
    const tooLong = await withdrawUserByAdministrator(
      { userId: userIdOf(1), reason: 'あ'.repeat(501) },
      asSuperAdmin(),
    );

    expect(codesOf(empty)).toStrictEqual(['validation_error']);
    expect(detailsOf(empty)).toStrictEqual([
      {
        field: 'input.reason',
        code: 'required',
        message: '理由を入力してください。',
      },
    ]);
    expect(detailsOf(tooLong).map(({ field }) => field)).toStrictEqual([
      'input.reason',
    ]);
    expect(await readUserState(1)).toStrictEqual(ACTIVE_STATE);
  });

  test('形式の違う利用者IDは存在しない利用者と同じ文言のvalidation_errorで拒否する', async () => {
    const response = await withdrawUserByAdministrator(
      { userId: 'not-an-id', reason: REQUEST_REASON },
      asSuperAdmin(),
    );

    expect(codesOf(response)).toStrictEqual(['validation_error']);
    expect(detailsOf(response)).toStrictEqual([
      {
        field: 'input.userId',
        code: 'invalid_format',
        message: USER_NOT_FOUND_MESSAGE,
      },
    ]);
  });

  test('確定が他の操作と競合したら管理画面の文言のaccount_state_conflictで拒否する', async () => {
    await insertTargetUser(1);
    conflictAccountTransitions();

    const response = await withdrawUserByAdministrator(
      { userId: userIdOf(1), reason: REQUEST_REASON },
      asSuperAdmin(),
    );

    expect(codesOf(response)).toStrictEqual(['account_state_conflict']);
    expect(response.errors?.[0]?.message).toBe(CONFLICT_MESSAGE);
    expect(await readUserState(1)).toStrictEqual(ACTIVE_STATE);
  });
});
