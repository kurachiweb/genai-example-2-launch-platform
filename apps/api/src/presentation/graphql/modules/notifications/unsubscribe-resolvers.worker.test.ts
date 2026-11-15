import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { notificationPreferences } from '../../../../../db/schema/notifications/notification-preferences.ts';
import {
  db,
  insertRecipient,
  recipientIdOf,
  T0,
} from '../../../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import {
  codesOf,
  confirmNotificationUnsubscribe,
  detailsOf,
  fetchNotificationUnsubscribeLink,
  installNotificationsGraphQLTest,
  suspendUserById,
  unsubscribeTokenOf,
} from '../../../../../test/support/notifications-graphql-operations.ts';

const RECIPIENT = 1;

const OPERATION_CATEGORY = 'api.graphql.operation';

const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';

// 形式は正しいが、どの種からも導出されないトークン
const UNKNOWN_TOKEN = `${'0123456789abcdef'.repeat(5)}01234A`;

const MALFORMED_TOKEN = 'a'.repeat(200);

const TOO_LONG_TOKEN = 'a'.repeat(201);

const { logs } = installNotificationsGraphQLTest();

async function insertRecipientPreference(
  topic: 'match_preview' | 'match_result',
  enabled: boolean,
): Promise<void> {
  await db.insert(notificationPreferences).values({
    userId: recipientIdOf(RECIPIENT),
    topic,
    enabled,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function readRecipientPreferences() {
  return db
    .select({
      topic: notificationPreferences.topic,
      enabled: notificationPreferences.enabled,
      updatedAt: notificationPreferences.updatedAt,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, recipientIdOf(RECIPIENT)));
}

async function recipientToken(): Promise<string> {
  await insertRecipient(RECIPIENT, { emailVerifiedAt: T0 });
  return unsubscribeTokenOf(recipientIdOf(RECIPIENT), 'match_result');
}

describe('呼び出し元の確認', () => {
  test.each([
    [
      'notificationUnsubscribeLink',
      (token: string) =>
        fetchNotificationUnsubscribeLink(token, { caller: 'admin' }),
    ],
    [
      'confirmNotificationUnsubscribe',
      (token: string) =>
        confirmNotificationUnsubscribe(token, { caller: 'admin' }),
    ],
  ])(
    '管理者側の呼び出し元からの%sはforbiddenで拒否し、受信設定を変えない',
    async (_name, call) => {
      const token = await recipientToken();
      await insertRecipientPreference('match_result', true);

      const response = await call(token);

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(await readRecipientPreferences()).toMatchObject([
        { topic: 'match_result', enabled: true },
      ]);
    },
  );
});

describe('トークンの長さの検証', () => {
  test.each([
    ['空', '', 'too_small'],
    ['201文字', TOO_LONG_TOKEN, 'too_big'],
  ])(
    '%sのトークンは照会と確定の両方でvalidation_errorにし、トークンを詳細に含めない',
    async (_name, token, code) => {
      const responses = [
        await fetchNotificationUnsubscribeLink(token),
        await confirmNotificationUnsubscribe(token),
      ];

      for (const response of responses) {
        expect(codesOf(response)).toEqual(['validation_error']);
        expect(detailsOf(response)).toEqual([
          {
            field: 'token',
            code,
            message: INVALID_LINK_MESSAGE,
          },
        ]);
      }
    },
  );
});

describe('notificationUnsubscribeLink', () => {
  test.each([
    ['形式違反', MALFORMED_TOKEN],
    ['照合できない', UNKNOWN_TOKEN],
  ])('%sのトークンはログインを求めずにnullを返す', async (_name, token) => {
    const response = await fetchNotificationUnsubscribeLink(token);

    expect(response.errors).toBeUndefined();
    expect(response.data?.notificationUnsubscribeLink).toBeNull();
  });

  test('有効なトークンはログインを求めずに種別と受信可否を返し、受信設定を変えない', async () => {
    const token = await recipientToken();
    await insertRecipientPreference('match_result', true);

    const response = await fetchNotificationUnsubscribeLink(token);

    expect(response.errors).toBeUndefined();
    expect(response.data?.notificationUnsubscribeLink).toEqual({
      topic: 'MATCH_RESULT',
      enabled: true,
    });
    expect(await readRecipientPreferences()).toEqual([
      { topic: 'match_result', enabled: true, updatedAt: T0 },
    ]);
  });

  test('受信設定の行が無い種別のトークンは受信しない設定として返す', async () => {
    const token = await recipientToken();

    const response = await fetchNotificationUnsubscribeLink(token);

    expect(response.data?.notificationUnsubscribeLink).toEqual({
      topic: 'MATCH_RESULT',
      enabled: false,
    });
  });
});

describe('confirmNotificationUnsubscribe', () => {
  test.each([
    ['形式違反', MALFORMED_TOKEN],
    ['照合できない', UNKNOWN_TOKEN],
  ])('%sのトークンはinvalid_linkで拒否する', async (_name, token) => {
    const response = await confirmNotificationUnsubscribe(token);

    expect(codesOf(response)).toEqual(['invalid_link']);
    expect(response.errors?.[0]?.message).toBe(INVALID_LINK_MESSAGE);
    expect(response.data).toBeNull();
  });

  test('受信する設定の種別をログインを求めずに停止し、種別と受信しない設定を返す', async () => {
    const token = await recipientToken();
    await insertRecipientPreference('match_result', true);
    await insertRecipientPreference('match_preview', true);

    const response = await confirmNotificationUnsubscribe(token);

    expect(response.errors).toBeUndefined();
    expect(response.data?.confirmNotificationUnsubscribe).toEqual({
      topic: 'MATCH_RESULT',
      enabled: false,
    });
    expect(
      (await readRecipientPreferences())
        .map(({ topic, enabled }) => ({ topic, enabled }))
        .sort((left, right) => left.topic.localeCompare(right.topic)),
    ).toEqual([
      { topic: 'match_preview', enabled: true },
      { topic: 'match_result', enabled: false },
    ]);
  });

  test('既に受信しない設定の種別は保存せずに成功として返す', async () => {
    const token = await recipientToken();
    await insertRecipientPreference('match_result', false);

    const response = await confirmNotificationUnsubscribe(token);

    expect(response.errors).toBeUndefined();
    expect(response.data?.confirmNotificationUnsubscribe).toEqual({
      topic: 'MATCH_RESULT',
      enabled: false,
    });
    expect(await readRecipientPreferences()).toEqual([
      { topic: 'match_result', enabled: false, updatedAt: T0 },
    ]);
  });

  test('停止中の利用者のトークンでも停止できる', async () => {
    const token = await recipientToken();
    await insertRecipientPreference('match_result', true);
    await suspendUserById(recipientIdOf(RECIPIENT));

    const response = await confirmNotificationUnsubscribe(token);

    expect(response.data?.confirmNotificationUnsubscribe).toEqual({
      topic: 'MATCH_RESULT',
      enabled: false,
    });
    expect(await readRecipientPreferences()).toMatchObject([
      { topic: 'match_result', enabled: false },
    ]);
  });
});

describe('ログ', () => {
  test('照会・確定・検証の失敗のいずれでも、トークンをログに出さない', async () => {
    const token = await recipientToken();
    await insertRecipientPreference('match_result', true);

    await fetchNotificationUnsubscribeLink(token);
    await confirmNotificationUnsubscribe(token);
    await confirmNotificationUnsubscribe(UNKNOWN_TOKEN);
    await fetchNotificationUnsubscribeLink(TOO_LONG_TOKEN);

    const recorded = JSON.stringify(logs());
    expect(
      logs().filter((log) => log.category === OPERATION_CATEGORY),
    ).toHaveLength(4);
    expect(recorded).not.toContain(token);
    expect(recorded).not.toContain(UNKNOWN_TOKEN);
    expect(recorded).not.toContain(TOO_LONG_TOKEN);
  });
});
