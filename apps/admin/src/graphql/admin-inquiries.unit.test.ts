import { describe, expect, test } from 'bun:test';
import { environmentManager, QueryClient } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';

import { createAppRuntimeHolder } from '../../lib/start/router-context.ts';
import { resolveBrowserDisplayPreferences } from '../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { toInquiryPeriod } from '../components/inquiry/inquiry-period.ts';
import {
  adminInquiriesQueryOptions,
  adminInquiryCategoryOptionsQueryOptions,
  adminInquiryQueryOptions,
  adminUnhandledInquiryCountQueryOptions,
  inquiryDetailActionContextOf,
  loadAdminInquiriesPage,
  loadAdminInquiryPage,
  markInquirySummariesStale,
  toAdminInquiryDetail,
  toAdminInquiryListPage,
  toInquiryCategoryOptions,
} from './admin-inquiries.ts';
import type {
  AdminInquiriesQuery,
  AdminInquiryQuery,
} from './generated/graphql.ts';

const MEMBER_ID = '01JC0MINQUIRY0000000000001';
const GUEST_ID = '01JC0GINQUIRY0000000000001';
const USER_ID = '01JC0USER00000000000000001';

const runtimeIn = (timeZone: string) =>
  createAppRuntimeHolder({
    publicConfig: {
      environment: 'local',
      turnstileSiteKey: '1x00000000000000000000BB',
      clientSiteOrigin: 'https://client.example',
      imagesOrigin: 'https://images.example',
      sentry: { dsn: undefined, environment: 'local', tracesSampleRate: 0 },
      webAnalyticsToken: undefined,
    },
    display: { timeZone, locale: 'ja-JP' },
  });

const LIST: AdminInquiriesQuery = {
  adminInquiries: {
    entries: [
      {
        id: MEMBER_ID,
        kind: 'MEMBER',
        category: { id: 'c1', name: '不具合の報告' },
        status: 'IN_PROGRESS',
        senderName: 'サンプル太郎',
        withdrawn: true,
        createdAt: '2026-11-03T01:00:00.000Z',
        lastMessageAt: '2026-11-04T02:00:00.000Z',
      },
      {
        id: GUEST_ID,
        kind: 'GUEST',
        category: { id: 'c2', name: 'その他' },
        status: 'OPEN',
        senderName: '訪問者',
        withdrawn: false,
        createdAt: '2026-11-02T01:00:00.000Z',
        lastMessageAt: '2026-11-02T01:00:00.000Z',
      },
    ],
    nextCursor: 'cursor-2',
  },
};

const AVATAR = {
  objectKey: 'fedcba9876543210'.repeat(2),
  fallbackFormat: 'JPG' as const,
  width: 512,
  height: 512,
};

type Detail = NonNullable<AdminInquiryQuery['adminInquiry']>;

const MEMBER_DETAIL: Detail = {
  id: MEMBER_ID,
  kind: 'MEMBER',
  category: { id: 'c1', name: '不具合の報告' },
  status: 'RESOLVED',
  statusChangedAt: '2026-11-04T03:00:00.000Z',
  withdrawn: false,
  createdAt: '2026-11-03T01:00:00.000Z',
  lastMessageAt: '2026-11-04T02:00:00.000Z',
  member: {
    userId: USER_ID,
    nickname: 'サンプル太郎',
    handle: 'sample_taro',
    avatar: AVATAR,
  },
  guest: null,
  messages: [
    {
      id: 'm1',
      sender: 'USER',
      body: '画面が表示されません。',
      attachments: [
        {
          id: 'f1',
          originalFileName: 'screen.png',
          contentType: 'image/png',
          byteSize: 2048,
        },
      ],
      admin: null,
      createdAt: '2026-11-03T01:00:00.000Z',
    },
    {
      id: 'm2',
      sender: 'ADMIN',
      body: '確認します。',
      attachments: [],
      admin: { nickname: '運営の担当', avatar: AVATAR, deleted: false },
      createdAt: '2026-11-03T02:00:00.000Z',
    },
    {
      id: 'm3',
      sender: 'ADMIN',
      body: '修正しました。',
      attachments: [],
      admin: { nickname: null, avatar: null, deleted: true },
      createdAt: '2026-11-04T02:00:00.000Z',
    },
  ],
};

const GUEST_DETAIL: Detail = {
  id: GUEST_ID,
  kind: 'GUEST',
  category: { id: 'c2', name: 'その他' },
  status: 'OPEN',
  statusChangedAt: '2026-11-02T01:00:00.000Z',
  withdrawn: false,
  createdAt: '2026-11-02T01:00:00.000Z',
  lastMessageAt: '2026-11-02T01:00:00.000Z',
  member: null,
  guest: {
    nickname: '訪問者',
    email: 'visitor@mail.example',
    body: '退会の方法を教えてください。',
  },
  messages: [
    {
      id: GUEST_ID,
      sender: 'USER',
      body: '退会の方法を教えてください。',
      attachments: [],
      admin: null,
      createdAt: '2026-11-02T01:00:00.000Z',
    },
  ],
};

describe('toAdminInquiryListPage', () => {
  test('一覧の行をアプリの種別・ステータスの値にし、次のページのカーソルを保つ', () => {
    expect(toAdminInquiryListPage(LIST)).toStrictEqual({
      entries: [
        {
          id: MEMBER_ID,
          kind: 'member',
          categoryName: '不具合の報告',
          status: 'in_progress',
          senderName: 'サンプル太郎',
          withdrawn: true,
          createdAt: '2026-11-03T01:00:00.000Z',
          lastMessageAt: '2026-11-04T02:00:00.000Z',
        },
        {
          id: GUEST_ID,
          kind: 'guest',
          categoryName: 'その他',
          status: 'open',
          senderName: '訪問者',
          withdrawn: false,
          createdAt: '2026-11-02T01:00:00.000Z',
          lastMessageAt: '2026-11-02T01:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-2',
    });
  });
});

describe('toInquiryCategoryOptions', () => {
  test('カテゴリをAPIの順(追加の順、標準カテゴリが末尾)のまま選択肢にする', () => {
    expect(
      toInquiryCategoryOptions({
        adminInquiryCategories: [
          { id: 'c1', name: '不具合の報告' },
          { id: 'c2', name: 'その他' },
        ],
      }),
    ).toStrictEqual([
      { value: 'c1', label: '不具合の報告' },
      { value: 'c2', label: 'その他' },
    ]);
  });
});

describe('toAdminInquiryDetail', () => {
  test('ログインの問い合わせは利用者・メッセージの送信者(管理者・削除済みの管理者)を表示用の形にする', () => {
    expect(toAdminInquiryDetail({ adminInquiry: MEMBER_DETAIL })).toStrictEqual(
      {
        kind: 'member',
        id: MEMBER_ID,
        categoryName: '不具合の報告',
        status: 'resolved',
        createdAt: '2026-11-03T01:00:00.000Z',
        withdrawn: false,
        member: {
          userId: USER_ID,
          nickname: 'サンプル太郎',
          handle: 'sample_taro',
          avatar: AVATAR,
        },
        messages: [
          {
            id: 'm1',
            sender: { kind: 'user' },
            body: '画面が表示されません。',
            attachments: [
              {
                id: 'f1',
                originalFileName: 'screen.png',
                contentType: 'image/png',
                byteSize: 2048,
              },
            ],
            createdAt: '2026-11-03T01:00:00.000Z',
          },
          {
            id: 'm2',
            sender: { kind: 'admin', nickname: '運営の担当', avatar: AVATAR },
            body: '確認します。',
            attachments: [],
            createdAt: '2026-11-03T02:00:00.000Z',
          },
          {
            id: 'm3',
            sender: { kind: 'deleted-admin' },
            body: '修正しました。',
            attachments: [],
            createdAt: '2026-11-04T02:00:00.000Z',
          },
        ],
      },
    );
  });

  test('未ログインの問い合わせはニックネーム・連絡先メールアドレス・本文を持つ', () => {
    expect(toAdminInquiryDetail({ adminInquiry: GUEST_DETAIL })).toStrictEqual({
      kind: 'guest',
      id: GUEST_ID,
      categoryName: 'その他',
      status: 'open',
      createdAt: '2026-11-02T01:00:00.000Z',
      guest: {
        nickname: '訪問者',
        email: 'visitor@mail.example',
        body: '退会の方法を教えてください。',
      },
    });
  });

  test('見つからなければundefinedにする', () => {
    expect(toAdminInquiryDetail({ adminInquiry: null })).toBeUndefined();
  });
});

describe('inquiryDetailActionContextOf', () => {
  test('ログインの問い合わせは利用者のIDと退会済みかを渡し、連絡先を渡さない', () => {
    const detail = toAdminInquiryDetail({
      adminInquiry: { ...MEMBER_DETAIL, withdrawn: true },
    });
    if (detail === undefined) {
      throw new Error('詳細を作れませんでした。');
    }

    expect(inquiryDetailActionContextOf(detail)).toStrictEqual({
      inquiryId: MEMBER_ID,
      kind: 'member',
      userId: USER_ID,
      withdrawn: true,
      contactEmail: null,
    });
  });

  test('送った利用者を読めないログインの問い合わせは利用者のIDをnullにする', () => {
    const detail = toAdminInquiryDetail({
      adminInquiry: { ...MEMBER_DETAIL, member: null },
    });
    if (detail === undefined) {
      throw new Error('詳細を作れませんでした。');
    }

    expect(inquiryDetailActionContextOf(detail).userId).toBeNull();
  });

  test('未ログインの問い合わせは利用者のIDを持たず、連絡先メールアドレスを渡す', () => {
    const detail = toAdminInquiryDetail({ adminInquiry: GUEST_DETAIL });
    if (detail === undefined) {
      throw new Error('詳細を作れませんでした。');
    }

    expect(inquiryDetailActionContextOf(detail)).toStrictEqual({
      inquiryId: GUEST_ID,
      kind: 'guest',
      userId: null,
      withdrawn: false,
      contactEmail: 'visitor@mail.example',
    });
  });
});

interface RecordingQueryClient {
  readonly client: QueryClient;
  readonly queried: unknown[];
}

const recordingQueryClient = ({
  categories = () => Promise.resolve(undefined),
  inquiries = () => Promise.resolve(undefined),
}: {
  readonly categories?: () => Promise<unknown>;
  readonly inquiries?: () => Promise<unknown>;
} = {}): RecordingQueryClient => {
  const queried: unknown[] = [];
  const inquiriesId = adminInquiriesQueryOptions({}).queryKey[0];
  const client = {
    query: (options: { readonly queryKey: readonly unknown[] }) => {
      queried.push(options.queryKey);
      return options.queryKey[0] === inquiriesId ? inquiries() : categories();
    },
  } as unknown as QueryClient;
  return { client, queried };
};

describe('loadAdminInquiriesPage', () => {
  test('カテゴリの選択肢と、検索パラメータの条件の一覧を、ルーターの文脈の地域の暦で同時に取得する', async () => {
    const { client, queried } = recordingQueryClient();

    await loadAdminInquiriesPage({
      context: { queryClient: client, runtime: runtimeIn('Asia/Tokyo') },
      deps: { status: 'OPEN', from: '2026-11-01', after: 'cursor-1' },
    });

    expect(queried).toStrictEqual([
      adminInquiryCategoryOptionsQueryOptions().queryKey,
      adminInquiriesQueryOptions({
        filter: { status: 'OPEN', receivedFrom: '2026-10-31T15:00:00.000Z' },
        after: 'cursor-1',
      }).queryKey,
    ]);
  });

  test('ブラウザでは、一覧の日時の表示と同じくブラウザの地域の暦で期間を決める', async () => {
    const { client, queried } = recordingQueryClient();
    environmentManager.setIsServer(() => false);
    try {
      await loadAdminInquiriesPage({
        context: {
          queryClient: client,
          runtime: runtimeIn('Pacific/Kiritimati'),
        },
        deps: { to: '2026-11-04' },
      });
    } finally {
      environmentManager.setIsServer(() => true);
    }

    expect(queried.at(-1)).toStrictEqual(
      adminInquiriesQueryOptions({
        filter: toInquiryPeriod(
          { to: '2026-11-04' },
          resolveBrowserDisplayPreferences().timeZone,
        ),
      }).queryKey,
    );
  });

  test('一覧の取得の失敗は一覧の場所で示すため投げず、カテゴリの選択肢の取得の失敗はエラーの画面に任せる', async () => {
    const failure = new GraphQLClientError({
      code: 'internal_error',
      message: '処理中に問題が発生しました。',
      status: 500,
    });

    await loadAdminInquiriesPage({
      context: {
        queryClient: recordingQueryClient({
          inquiries: () => Promise.reject(failure),
        }).client,
        runtime: runtimeIn('Asia/Tokyo'),
      },
      deps: {},
    });
    const error: unknown = await loadAdminInquiriesPage({
      context: {
        queryClient: recordingQueryClient({
          categories: () => Promise.reject(failure),
        }).client,
        runtime: runtimeIn('Asia/Tokyo'),
      },
      deps: {},
    }).catch((caught: unknown) => caught);
    expect(error).toBe(failure);
  });
});

describe('loadAdminInquiryPage', () => {
  const clientReturning = (result: () => Promise<unknown>) => {
    const queried: unknown[] = [];
    const client = {
      query: (options: unknown) => {
        queried.push(options);
        return result();
      },
    } as unknown as QueryClient;
    return { client, queried };
  };

  test('詳細をキャッシュの鮮度によらず毎回取得する', async () => {
    const { client, queried } = clientReturning(() =>
      Promise.resolve({ adminInquiry: GUEST_DETAIL }),
    );

    await loadAdminInquiryPage({
      context: { queryClient: client },
      params: { inquiryId: GUEST_ID },
    });

    expect(queried).toStrictEqual([
      expect.objectContaining({
        queryKey: adminInquiryQueryOptions(GUEST_ID).queryKey,
        staleTime: 0,
      }),
    ]);
  });

  test('見つからない問い合わせと、IDの形式の違反は見つからない扱いにする', async () => {
    const missing = clientReturning(() =>
      Promise.resolve({ adminInquiry: null }),
    );
    const malformed = clientReturning(() =>
      Promise.reject(
        new GraphQLClientError({
          code: 'validation_error',
          message: '入力内容に誤りがあります。',
          status: 400,
          details: [
            {
              field: 'id',
              code: 'too_big',
              message: '問い合わせが見つかりません。',
            },
          ],
        }),
      ),
    );

    for (const { client } of [missing, malformed]) {
      const error: unknown = await loadAdminInquiryPage({
        context: { queryClient: client },
        params: { inquiryId: 'x'.repeat(65) },
      }).catch((caught: unknown) => caught);
      expect(isNotFound(error)).toBe(true);
    }
  });

  test('それ以外の取得の失敗はエラーの画面に任せる', async () => {
    const failure = new GraphQLClientError({
      code: 'internal_error',
      message: '処理中に問題が発生しました。',
      status: 500,
    });
    const { client } = clientReturning(() => Promise.reject(failure));

    const error: unknown = await loadAdminInquiryPage({
      context: { queryClient: client },
      params: { inquiryId: MEMBER_ID },
    }).catch((caught: unknown) => caught);
    expect(error).toBe(failure);
  });
});

describe('adminUnhandledInquiryCountQueryOptions', () => {
  test('返信・ステータスの変更の後に、ダッシュボードの未対応の件数を表示中でなくても古いものとし、取得し直させない', async () => {
    const queryClient = new QueryClient();
    const { queryKey } = adminUnhandledInquiryCountQueryOptions();
    queryClient.setQueryData(queryKey, { adminUnhandledInquiryCount: 3 });

    await markInquirySummariesStale(queryClient);

    const state = queryClient.getQueryState(queryKey);
    expect(state?.isInvalidated).toBe(true);
    expect(state?.fetchStatus).toBe('idle');
    expect(state?.data).toStrictEqual({ adminUnhandledInquiryCount: 3 });
  });
});
