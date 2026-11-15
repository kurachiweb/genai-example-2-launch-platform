import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../common-lib/notifications/notification-topics.ts';
import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientNotificationUnsubscribeLinkDocument,
  ClientViewerNotificationSettingsDocument,
  type NotificationSettingsFragment,
  type NotificationTopic as NotificationTopicValue,
} from './generated/graphql.ts';
import {
  loadNotificationSettings,
  notificationSettingsQueryOptions,
  notificationTopicOf,
  notificationTopicValueOf,
  notificationUnsubscribeLinkQueryOptions,
  toNotificationSettingsView,
  withSavedNotificationPreference,
} from './notification-settings.ts';

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const OTHER_VIEWER_ID = '01JC0VIEWER0000000000000001';

const TOKEN = `unsubscribe${'A'.repeat(40)}`;

const SETTINGS_DOCUMENT_ID = documentIdOf(
  ClientViewerNotificationSettingsDocument,
);

const LINK_DOCUMENT_ID = documentIdOf(
  ClientNotificationUnsubscribeLinkDocument,
);

const TOPIC_VALUES: readonly (readonly [
  NotificationTopic,
  NotificationTopicValue,
])[] = [
  ['match_preview', 'MATCH_PREVIEW'],
  ['match_result', 'MATCH_RESULT'],
  ['followed_user_match', 'FOLLOWED_USER_MATCH'],
  ['followed_user_award', 'FOLLOWED_USER_AWARD'],
];

const settingsOf = (
  overrides: Partial<NotificationSettingsFragment> = {},
): NotificationSettingsFragment => ({
  preferences: [
    { topic: 'MATCH_PREVIEW', enabled: false },
    { topic: 'MATCH_RESULT', enabled: true },
    { topic: 'FOLLOWED_USER_MATCH', enabled: false },
    { topic: 'FOLLOWED_USER_AWARD', enabled: true },
  ],
  suppression: null,
  deliveryStatusAvailable: true,
  emailVerified: true,
  editable: true,
  ...overrides,
});

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で取得し、APIへ送った識別子と変数を読み取る
const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  respond: () => Promise<Response>,
) => {
  const api = recordingApi(respond);
  const queryClient = new QueryClient();
  let result: unknown;
  await runInStartRequest({
    context: renderContextOf({ api, reported: [] }),
    render: async () => {
      result = await run(queryClient).catch((error: unknown) => error);
      return htmlResponse();
    },
  });
  const sent = await Promise.all(api.requests.map((request) => request.json()));
  return { result, sent };
};

describe('通知種別の写し', () => {
  test.each(TOPIC_VALUES)(
    '%sはGraphQLの列挙の%sと相互に写す',
    (topic, value) => {
      expect(notificationTopicValueOf(topic)).toBe(value);
      expect(notificationTopicOf(value)).toBe(topic);
    },
  );
});

describe('notificationSettingsQueryOptions', () => {
  test('照会の識別子と空の変数で始まり、閲覧者ごとに別のキーにする', () => {
    const mine = notificationSettingsQueryOptions(VIEWER_ID).queryKey;
    const other = notificationSettingsQueryOptions(OTHER_VIEWER_ID).queryKey;

    expect(mine.slice(0, 2)).toStrictEqual([SETTINGS_DOCUMENT_ID, {}]);
    expect(JSON.stringify(mine)).not.toBe(JSON.stringify(other));
  });

  test('照会の結果から通知設定を取り出す', async () => {
    const settings = settingsOf();
    const { result, sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(notificationSettingsQueryOptions(VIEWER_ID)),
      () =>
        Promise.resolve(
          graphqlResponse({ data: { viewerNotificationSettings: settings } }),
        ),
    );

    expect(sent).toStrictEqual([
      { documentId: SETTINGS_DOCUMENT_ID, variables: {} },
    ]);
    expect(result).toStrictEqual(settings);
  });
});

describe('loadNotificationSettings', () => {
  test('キャッシュにあれば取得し直さない', async () => {
    const { sent } = await runThroughApi(
      async (queryClient) => {
        const context = { queryClient, viewer: { id: VIEWER_ID } };
        await loadNotificationSettings({ context });
        await loadNotificationSettings({ context });
      },
      () =>
        Promise.resolve(
          graphqlResponse({
            data: { viewerNotificationSettings: settingsOf() },
          }),
        ),
    );

    expect(sent).toHaveLength(1);
  });

  test('通知設定が無ければページを表示できないため、取得の失敗をそのまま投げる', async () => {
    const { result } = await runThroughApi(
      (queryClient) =>
        loadNotificationSettings({
          context: { queryClient, viewer: { id: VIEWER_ID } },
        }),
      () =>
        Promise.resolve(
          graphqlResponse({
            errors: [
              {
                message: 'ログインしてください。',
                extensions: { code: 'unauthenticated' },
              },
            ],
          }),
        ),
    );

    expect(result).toBeInstanceOf(GraphQLClientError);
    expect((result as GraphQLClientError).code).toBe('unauthenticated');
  });
});

describe('toNotificationSettingsView', () => {
  test('応答の並びによらず共有の通知種別の順に並べ、受信可否と状態をそのまま写す', () => {
    const view = toNotificationSettingsView(
      settingsOf({
        preferences: [
          { topic: 'FOLLOWED_USER_AWARD', enabled: true },
          { topic: 'MATCH_RESULT', enabled: true },
          { topic: 'FOLLOWED_USER_MATCH', enabled: false },
          { topic: 'MATCH_PREVIEW', enabled: false },
        ],
        deliveryStatusAvailable: false,
        emailVerified: false,
        editable: false,
      }),
    );

    expect(view).toStrictEqual({
      preferences: [
        { topic: 'match_preview', enabled: false },
        { topic: 'match_result', enabled: true },
        { topic: 'followed_user_match', enabled: false },
        { topic: 'followed_user_award', enabled: true },
      ],
      suppression: null,
      deliveryStatusAvailable: false,
      emailVerified: false,
      editable: false,
    });
    expect(view.preferences.map(({ topic }) => topic)).toStrictEqual([
      ...NOTIFICATION_TOPICS,
    ]);
  });

  test('応答に無い通知種別は受け取らない設定として並べる', () => {
    const view = toNotificationSettingsView(
      settingsOf({ preferences: [{ topic: 'MATCH_RESULT', enabled: true }] }),
    );

    expect(view.preferences).toStrictEqual([
      { topic: 'match_preview', enabled: false },
      { topic: 'match_result', enabled: true },
      { topic: 'followed_user_match', enabled: false },
      { topic: 'followed_user_award', enabled: false },
    ]);
  });

  test.each(['BOUNCE', 'COMPLAINT'] as const)(
    '期限の無い除外(%s)は理由だけを写す',
    (reason) => {
      expect(
        toNotificationSettingsView(
          settingsOf({ suppression: { reason, until: null } }),
        ).suppression,
      ).toStrictEqual({ reason });
    },
  );

  test('受信側の拒否は期限の日時とともに写す', () => {
    expect(
      toNotificationSettingsView(
        settingsOf({
          suppression: {
            reason: 'REJECTED',
            until: '2026-11-21T03:00:00.000Z',
          },
        }),
      ).suppression,
    ).toStrictEqual({
      reason: 'REJECTED',
      until: '2026-11-21T03:00:00.000Z',
    });
  });

  test('期限の無い受信側の拒否は、先の恒久的な除外が続いているため配信できなかった旨として写す', () => {
    expect(
      toNotificationSettingsView(
        settingsOf({ suppression: { reason: 'REJECTED', until: null } }),
      ).suppression,
    ).toStrictEqual({ reason: 'BOUNCE' });
  });
});

describe('withSavedNotificationPreference', () => {
  test('今のキャッシュのうち保存した種別の受信可否だけを応答の値にし、他の種別と配信の状態などは今のキャッシュのまま保つ', () => {
    const current = settingsOf({
      suppression: { reason: 'BOUNCE', until: null },
    });
    const saved = settingsOf({
      preferences: [
        { topic: 'MATCH_PREVIEW', enabled: true },
        { topic: 'MATCH_RESULT', enabled: false },
        { topic: 'FOLLOWED_USER_MATCH', enabled: true },
        { topic: 'FOLLOWED_USER_AWARD', enabled: false },
      ],
      deliveryStatusAvailable: false,
    });

    expect(
      withSavedNotificationPreference(current, saved, 'match_preview'),
    ).toStrictEqual(
      settingsOf({
        preferences: [
          { topic: 'MATCH_PREVIEW', enabled: true },
          { topic: 'MATCH_RESULT', enabled: true },
          { topic: 'FOLLOWED_USER_MATCH', enabled: false },
          { topic: 'FOLLOWED_USER_AWARD', enabled: true },
        ],
        suppression: { reason: 'BOUNCE', until: null },
      }),
    );
  });

  test('今のキャッシュを書き換えず、新しい値を返す', () => {
    const current = settingsOf();
    const before = structuredClone(current);

    withSavedNotificationPreference(
      current,
      settingsOf({
        preferences: [{ topic: 'MATCH_RESULT', enabled: false }],
      }),
      'match_result',
    );

    expect(current).toStrictEqual(before);
  });

  test('今のキャッシュに保存した種別が無ければ、応答の値で加える', () => {
    expect(
      withSavedNotificationPreference(
        settingsOf({ preferences: [{ topic: 'MATCH_RESULT', enabled: true }] }),
        settingsOf(),
        'followed_user_award',
      ).preferences,
    ).toStrictEqual([
      { topic: 'MATCH_RESULT', enabled: true },
      { topic: 'FOLLOWED_USER_AWARD', enabled: true },
    ]);
  });

  test('応答に保存した種別が無ければ、受け取らない設定にする', () => {
    expect(
      withSavedNotificationPreference(
        settingsOf(),
        settingsOf({ preferences: [] }),
        'match_result',
      ).preferences,
    ).toStrictEqual(
      settingsOf().preferences.map((preference) =>
        preference.topic === 'MATCH_RESULT'
          ? { ...preference, enabled: false }
          : preference,
      ),
    );
  });

  test('キャッシュが無ければ応答の全体を使う', () => {
    const saved = settingsOf({ emailVerified: false });

    expect(
      withSavedNotificationPreference(undefined, saved, 'match_result'),
    ).toBe(saved);
  });
});

describe('notificationUnsubscribeLinkQueryOptions', () => {
  test('照会の識別子とトークンの変数をキーにする', () => {
    expect([
      ...notificationUnsubscribeLinkQueryOptions(TOKEN).queryKey,
    ]).toStrictEqual([LINK_DOCUMENT_ID, { token: TOKEN }]);
  });

  const linkResult = (respond: () => Promise<Response>) =>
    runThroughApi(
      (queryClient) =>
        queryClient.query({
          ...notificationUnsubscribeLinkQueryOptions(TOKEN),
          retry: false,
        }),
      respond,
    );

  test('受信する設定の種別は確認の状態にし、トークンを変数にして照会する', async () => {
    const { result, sent } = await linkResult(() =>
      Promise.resolve(
        graphqlResponse({
          data: {
            notificationUnsubscribeLink: {
              topic: 'MATCH_RESULT',
              enabled: true,
            },
          },
        }),
      ),
    );

    expect(sent).toStrictEqual([
      { documentId: LINK_DOCUMENT_ID, variables: { token: TOKEN } },
    ]);
    expect(result).toStrictEqual({
      status: 'subscribed',
      topic: 'match_result',
    });
  });

  test('既に受信を停止している種別は既に停止の状態にする', async () => {
    const { result } = await linkResult(() =>
      Promise.resolve(
        graphqlResponse({
          data: {
            notificationUnsubscribeLink: {
              topic: 'FOLLOWED_USER_AWARD',
              enabled: false,
            },
          },
        }),
      ),
    );

    expect(result).toStrictEqual({
      status: 'already_disabled',
      topic: 'followed_user_award',
    });
  });

  test('照合できないトークンの結果(null)は無効の状態にする', async () => {
    const { result } = await linkResult(() =>
      Promise.resolve(
        graphqlResponse({ data: { notificationUnsubscribeLink: null } }),
      ),
    );

    expect(result).toStrictEqual({ status: 'invalid' });
  });

  test('トークンの長さの検証の失敗は、失敗にせず無効の状態にする', async () => {
    const { result } = await linkResult(() =>
      Promise.resolve(
        graphqlResponse({
          errors: [
            {
              message: '入力内容を確認してください。',
              extensions: {
                code: 'validation_error',
                details: [
                  {
                    field: 'token',
                    code: 'too_big',
                    message: 'このリンクは無効か、有効期限が切れています。',
                  },
                ],
              },
            },
          ],
        }),
      ),
    );

    expect(result).toStrictEqual({ status: 'invalid' });
  });

  test('無効なリンクの旨でない失敗は、再試行できるようそのまま投げる', async () => {
    const { result } = await linkResult(() =>
      Promise.resolve(
        graphqlResponse({
          errors: [
            {
              message: 'サーバーでエラーが発生しました。',
              extensions: { code: 'internal_error' },
            },
          ],
        }),
      ),
    );

    expect(result).toBeInstanceOf(GraphQLClientError);
    expect((result as GraphQLClientError).code).toBe('internal_error');
  });
});
