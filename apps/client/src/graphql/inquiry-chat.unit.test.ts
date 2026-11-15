import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientMemberInquiryDocument,
  type ClientMemberInquiryQuery,
} from './generated/graphql.ts';
import {
  loadInquiryChatPage,
  memberInquiryQueryOptions,
  toInquiryChat,
} from './inquiry-chat.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const INQUIRY_ID = '01JC0INQVRY000000000000001';

const ADMIN_AVATAR = {
  objectKey: 'fedcba9876543210fedcba9876543210',
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
} as const;

const RESULT: ClientMemberInquiryQuery = {
  memberInquiry: {
    id: INQUIRY_ID,
    category: { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' },
    status: 'RESOLVED',
    createdAt: '2026-11-04T01:00:00.000Z',
    canPost: true,
    messages: [
      {
        id: INQUIRY_ID,
        sender: 'USER',
        body: '画面が表示されません。',
        createdAt: '2026-11-04T01:00:00.000Z',
        attachments: [
          {
            id: '01JC0F1LE0000000000000001',
            originalFileName: 'screenshot.png',
            contentType: 'image/png',
            byteSize: 2048,
          },
        ],
        admin: null,
      },
      {
        id: '01JC0MESSAGE00000000000002',
        sender: 'ADMIN',
        body: '確認します。',
        createdAt: '2026-11-04T02:00:00.000Z',
        attachments: [],
        admin: {
          nickname: 'サポート担当',
          avatar: ADMIN_AVATAR,
          deleted: false,
        },
      },
      {
        id: '01JC0MESSAGE00000000000003',
        sender: 'ADMIN',
        body: '対応しました。',
        createdAt: '2026-11-04T03:00:00.000Z',
        attachments: [],
        admin: { nickname: null, avatar: null, deleted: true },
      },
    ],
  },
};

describe('toInquiryChat', () => {
  test('応答の順のまま、ステータスを表示部品の値にし、送信者を自分・管理者・削除済みの管理者に分ける', () => {
    expect(toInquiryChat(RESULT)).toStrictEqual({
      id: INQUIRY_ID,
      categoryName: '不具合の報告',
      status: 'resolved',
      createdAt: '2026-11-04T01:00:00.000Z',
      canPost: true,
      messages: [
        {
          id: INQUIRY_ID,
          sender: { kind: 'self' },
          body: '画面が表示されません。',
          createdAt: '2026-11-04T01:00:00.000Z',
          attachments: [
            {
              id: '01JC0F1LE0000000000000001',
              originalFileName: 'screenshot.png',
              contentType: 'image/png',
              byteSize: 2048,
            },
          ],
        },
        {
          id: '01JC0MESSAGE00000000000002',
          sender: {
            kind: 'admin',
            nickname: 'サポート担当',
            avatar: ADMIN_AVATAR,
          },
          body: '確認します。',
          createdAt: '2026-11-04T02:00:00.000Z',
          attachments: [],
        },
        {
          id: '01JC0MESSAGE00000000000003',
          sender: { kind: 'deleted-admin' },
          body: '対応しました。',
          createdAt: '2026-11-04T03:00:00.000Z',
          attachments: [],
        },
      ],
    });
  });

  test('管理者の返信で管理者の情報もニックネームも無ければ、削除済みの管理者として扱う', () => {
    const inquiry = RESULT.memberInquiry;
    const first = inquiry?.messages[0];
    if (inquiry === null || first === undefined) {
      throw new Error('前提の問い合わせがありません。');
    }

    const chat = toInquiryChat({
      memberInquiry: {
        ...inquiry,
        messages: [
          { ...first, sender: 'ADMIN', admin: null },
          {
            ...first,
            id: '01JC0MESSAGE00000000000004',
            sender: 'ADMIN',
            admin: { nickname: null, avatar: null, deleted: false },
          },
        ],
      },
    });

    expect(chat?.messages.map(({ sender }) => sender)).toStrictEqual([
      { kind: 'deleted-admin' },
      { kind: 'deleted-admin' },
    ]);
  });

  test('本人の問い合わせでなく取得できなければundefinedにする', () => {
    expect(toInquiryChat({ memberInquiry: null })).toBeUndefined();
  });
});

describe('memberInquiryQueryOptions', () => {
  test('操作の識別子と問い合わせのIDで始まり、閲覧者と利用者の状態ごとに別のキーにする', () => {
    const active = memberInquiryQueryOptions(VIEWER, INQUIRY_ID).queryKey;
    const suspended = memberInquiryQueryOptions(
      { ...VIEWER, status: 'SUSPENDED' },
      INQUIRY_ID,
    ).queryKey;
    const other = memberInquiryQueryOptions(
      { ...VIEWER, id: '01JC0VIEWER0000000000000001' },
      INQUIRY_ID,
    ).queryKey;
    const otherInquiry = memberInquiryQueryOptions(
      VIEWER,
      '01JC0INQVRY000000000000002',
    ).queryKey;

    expect(active.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientMemberInquiryDocument),
      { id: INQUIRY_ID },
    ]);
    expect(
      new Set(
        [active, suspended, other, otherInquiry].map((key) =>
          JSON.stringify(key),
        ),
      ).size,
    ).toBe(4);
  });
});

// 外部へ通信しないよう、同じキーの取得を先に始めておき、loaderの取得をその取得の結果に合流させる
const loadWhileFetching = async (
  inquiryId: string,
  fetched: () => Promise<ClientMemberInquiryQuery>,
): Promise<unknown> => {
  const queryClient = new QueryClient();
  void queryClient
    .query({
      queryKey: memberInquiryQueryOptions(VIEWER, inquiryId).queryKey,
      queryFn: fetched,
      retry: false,
    })
    .catch(() => undefined);
  return loadInquiryChatPage({
    context: { queryClient, viewer: VIEWER },
    params: { inquiryId },
  }).then(
    () => 'loaded',
    (error: unknown) => error,
  );
};

const validationError = (field: string) =>
  new GraphQLClientError({
    code: 'validation_error',
    message: '入力内容を確認してください。',
    status: 400,
    details: [
      { field, code: 'too_big', message: '問い合わせが見つかりません。' },
    ],
  });

describe('loadInquiryChatPage', () => {
  test('本人の問い合わせを取得できれば、ページを表示する', async () => {
    expect(
      await loadWhileFetching(INQUIRY_ID, () => Promise.resolve(RESULT)),
    ).toBe('loaded');
  });

  test('本人の問い合わせでなければ、存在しないページにする', async () => {
    const result = await loadWhileFetching(INQUIRY_ID, () =>
      Promise.resolve({ memberInquiry: null }),
    );

    expect(isNotFound(result)).toBe(true);
  });

  test('IDの形式の違反は、存在を明かさないよう他人・不在と同じく存在しないページにする', async () => {
    const result = await loadWhileFetching('0'.repeat(65), () =>
      Promise.reject(validationError('id')),
    );

    expect(isNotFound(result)).toBe(true);
  });

  test('IDの形式の違反でない失敗は、そのまま投げてエラーの画面にする', async () => {
    const serverError = new GraphQLClientError({
      code: 'internal_error',
      message: 'サーバーでエラーが発生しました。',
      status: 500,
    });
    const otherField = validationError('after');

    expect(
      await loadWhileFetching(INQUIRY_ID, () => Promise.reject(serverError)),
    ).toBe(serverError);
    expect(
      await loadWhileFetching(INQUIRY_ID, () => Promise.reject(otherField)),
    ).toBe(otherField);
  });
});
