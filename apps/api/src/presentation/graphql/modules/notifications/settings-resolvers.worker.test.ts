import { describe, expect, test } from 'vitest';

import { emailOf } from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  insertPreference,
  insertUser,
  readPreferencesOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import {
  codesOf,
  failSuppressionLookup,
  fetchViewerNotificationSettings,
  installNotificationsGraphQLTest,
  issueSessionOf,
  suppressAddress,
  suspendUserById,
  updateNotificationPreference,
} from '../../../../../test/support/notifications-graphql-operations.ts';

const MEMBER = 1;

const DAY_MS = 86_400_000;

const ALL_DISABLED = [
  { topic: 'MATCH_PREVIEW', enabled: false },
  { topic: 'MATCH_RESULT', enabled: false },
  { topic: 'FOLLOWED_USER_MATCH', enabled: false },
  { topic: 'FOLLOWED_USER_AWARD', enabled: false },
];

installNotificationsGraphQLTest();

async function memberSession(
  columns: Parameters<typeof insertUser>[1] = { emailVerifiedAt: T0 },
): Promise<string> {
  await insertUser(MEMBER, columns);
  return issueSessionOf(userIdOf(MEMBER));
}

describe('呼び出し元の確認', () => {
  test.each([
    [
      'viewerNotificationSettings',
      (sessionToken: string) =>
        fetchViewerNotificationSettings({ caller: 'admin', sessionToken }),
    ],
    [
      'updateNotificationPreference',
      (sessionToken: string) =>
        updateNotificationPreference(
          { topic: 'MATCH_RESULT', enabled: true },
          { caller: 'admin', sessionToken },
        ),
    ],
  ])(
    '管理者側の呼び出し元からの%sはforbiddenで拒否し、受信設定を変えない',
    async (_name, call) => {
      const sessionToken = await memberSession();

      const response = await call(sessionToken);

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(await readPreferencesOf(MEMBER)).toEqual([]);
    },
  );
});

describe('viewerNotificationSettings', () => {
  test('未ログインはunauthenticatedで拒否する', async () => {
    const response = await fetchViewerNotificationSettings();

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(response.data).toBeNull();
  });

  test('4つの通知種別を決まった順に受信可否とともに返し、行が無い種別は受信しない設定として返す', async () => {
    const sessionToken = await memberSession();
    await insertPreference(MEMBER, 'match_result', true);
    await insertPreference(MEMBER, 'followed_user_award', false);

    const response = await fetchViewerNotificationSettings({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.viewerNotificationSettings).toEqual({
      preferences: [
        { topic: 'MATCH_PREVIEW', enabled: false },
        { topic: 'MATCH_RESULT', enabled: true },
        { topic: 'FOLLOWED_USER_MATCH', enabled: false },
        { topic: 'FOLLOWED_USER_AWARD', enabled: false },
      ],
      suppression: null,
      deliveryStatusAvailable: true,
      emailVerified: true,
      editable: true,
    });
  });

  test('メールアドレスが未確認の利用者には確認済みでないことを返し、変更は許す', async () => {
    const sessionToken = await memberSession({ emailVerifiedAt: null });

    const response = await fetchViewerNotificationSettings({ sessionToken });

    expect(response.data?.viewerNotificationSettings).toMatchObject({
      emailVerified: false,
      editable: true,
    });
  });

  test('停止中の利用者にも設定を返し、変更できないことを示す', async () => {
    const sessionToken = await memberSession();
    await insertPreference(MEMBER, 'match_preview', true);
    await suspendUserById(userIdOf(MEMBER));

    const response = await fetchViewerNotificationSettings({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.viewerNotificationSettings).toMatchObject({
      preferences: [
        { topic: 'MATCH_PREVIEW', enabled: true },
        { topic: 'MATCH_RESULT', enabled: false },
        { topic: 'FOLLOWED_USER_MATCH', enabled: false },
        { topic: 'FOLLOWED_USER_AWARD', enabled: false },
      ],
      editable: false,
    });
  });

  test.each([
    ['hard_bounce', 'BOUNCE'],
    ['complaint', 'COMPLAINT'],
  ] as const)(
    '恒久的な除外(%s)は理由%sを期限なしで返す',
    async (reason, expected) => {
      const sessionToken = await memberSession();
      await suppressAddress(emailOf(MEMBER), reason, null);

      const response = await fetchViewerNotificationSettings({ sessionToken });

      expect(response.data?.viewerNotificationSettings).toMatchObject({
        suppression: { reason: expected, until: null },
        deliveryStatusAvailable: true,
      });
    },
  );

  test('受信側の拒否による期限付きの除外は、理由と除外が解ける日時を返す', async () => {
    const sessionToken = await memberSession();
    const expiresAt = new Date(
      Math.floor((Date.now() + 3 * DAY_MS) / 1000) * 1000,
    );
    await suppressAddress(emailOf(MEMBER), 'rejected', expiresAt);

    const response = await fetchViewerNotificationSettings({ sessionToken });

    expect(response.data?.viewerNotificationSettings).toMatchObject({
      suppression: { reason: 'REJECTED', until: expiresAt.toISOString() },
      deliveryStatusAvailable: true,
    });
  });

  test('除外の状態を照会できなければ、受信可否を返したうえで配信の状態を確認できないことを示す', async () => {
    const sessionToken = await memberSession();
    await insertPreference(MEMBER, 'match_result', true);
    failSuppressionLookup();

    const response = await fetchViewerNotificationSettings({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.viewerNotificationSettings).toMatchObject({
      preferences: [
        { topic: 'MATCH_PREVIEW', enabled: false },
        { topic: 'MATCH_RESULT', enabled: true },
        { topic: 'FOLLOWED_USER_MATCH', enabled: false },
        { topic: 'FOLLOWED_USER_AWARD', enabled: false },
      ],
      suppression: null,
      deliveryStatusAvailable: false,
      editable: true,
    });
  });
});

describe('updateNotificationPreference', () => {
  test('未ログインはunauthenticatedで拒否する', async () => {
    const response = await updateNotificationPreference({
      topic: 'MATCH_RESULT',
      enabled: true,
    });

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(response.data).toBeNull();
  });

  test('停止中の利用者はaccount_unavailableで拒否し、受信設定を変えない', async () => {
    const sessionToken = await memberSession();
    await suspendUserById(userIdOf(MEMBER));

    const response = await updateNotificationPreference(
      { topic: 'MATCH_RESULT', enabled: true },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(await readPreferencesOf(MEMBER)).toEqual([]);
  });

  test('指定した1つの通知種別の受信可否だけを保存し、保存の後の設定を返す', async () => {
    const sessionToken = await memberSession();
    await insertPreference(MEMBER, 'match_preview', true);

    const response = await updateNotificationPreference(
      { topic: 'FOLLOWED_USER_MATCH', enabled: true },
      { sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateNotificationPreference).toEqual({
      preferences: [
        { topic: 'MATCH_PREVIEW', enabled: true },
        { topic: 'MATCH_RESULT', enabled: false },
        { topic: 'FOLLOWED_USER_MATCH', enabled: true },
        { topic: 'FOLLOWED_USER_AWARD', enabled: false },
      ],
      suppression: null,
      deliveryStatusAvailable: true,
      emailVerified: true,
      editable: true,
    });
    expect(
      (await readPreferencesOf(MEMBER)).map(({ topic, enabled }) => ({
        topic,
        enabled,
      })),
    ).toEqual([
      { topic: 'followed_user_match', enabled: true },
      { topic: 'match_preview', enabled: true },
    ]);
  });

  test('受信する設定を受信しない設定へ戻せる', async () => {
    const sessionToken = await memberSession();
    await insertPreference(MEMBER, 'match_result', true);

    const response = await updateNotificationPreference(
      { topic: 'MATCH_RESULT', enabled: false },
      { sessionToken },
    );

    expect(response.data?.updateNotificationPreference?.preferences).toEqual(
      ALL_DISABLED,
    );
    expect(await readPreferencesOf(MEMBER)).toMatchObject([
      { topic: 'match_result', enabled: false },
    ]);
  });

  test('メールアドレスが未確認の利用者の変更も受け付ける', async () => {
    const sessionToken = await memberSession({ emailVerifiedAt: null });

    const response = await updateNotificationPreference(
      { topic: 'MATCH_PREVIEW', enabled: true },
      { sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(await readPreferencesOf(MEMBER)).toMatchObject([
      { topic: 'match_preview', enabled: true },
    ]);
  });
});
