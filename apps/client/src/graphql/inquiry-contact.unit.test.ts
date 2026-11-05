import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientInquiryContactFormDocument,
  type ClientInquiryContactFormQuery,
  ClientMyInquiriesDocument,
  type ClientMyInquiriesQuery,
} from './generated/graphql.ts';
import {
  inquiryContactQueryOptions,
  loadContactPage,
  myInquiriesQueryOptions,
  toInquiryContactFormView,
  toMyInquiryPage,
} from './inquiry-contact.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const RESULT: ClientInquiryContactFormQuery = {
  inquiryCategories: [
    { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' },
    { id: '01JC0000000000000000000000', name: 'その他' },
  ],
  inquiryComposer: {
    nickname: 'ピッチの作り手',
    avatar: {
      objectKey: 'fedcba9876543210fedcba9876543210',
      fallbackFormat: 'PNG',
      width: 512,
      height: 512,
    },
  },
};

const MY_INQUIRIES: ClientMyInquiriesQuery = {
  myInquiries: {
    items: [
      {
        id: '01JC0INQVRY000000000000002',
        category: { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' },
        status: 'IN_PROGRESS',
        createdAt: '2026-11-04T01:00:00.000Z',
        lastMessageAt: '2026-11-05T02:30:00.000Z',
      },
      {
        id: '01JC0INQVRY000000000000001',
        category: { id: '01JC0000000000000000000000', name: 'その他' },
        status: 'OPEN',
        createdAt: '2026-11-03T01:00:00.000Z',
        lastMessageAt: '2026-11-03T01:00:00.000Z',
      },
    ],
    nextCursor: 'cursor-2',
  },
};

describe('toInquiryContactFormView', () => {
  test('カテゴリを応答の順のまま、送信者をアバターの表示に使う形で取り出す', () => {
    expect(toInquiryContactFormView(RESULT)).toStrictEqual({
      categories: [
        { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' },
        { id: '01JC0000000000000000000000', name: 'その他' },
      ],
      composer: {
        nickname: 'ピッチの作り手',
        avatar: {
          objectKey: 'fedcba9876543210fedcba9876543210',
          fallbackFormat: 'PNG',
          width: 512,
          height: 512,
        },
      },
    });
  });

  test('送信者が無ければnullにする', () => {
    expect(
      toInquiryContactFormView({ ...RESULT, inquiryComposer: null }).composer,
    ).toBeNull();
  });
});

describe('inquiryContactQueryOptions', () => {
  test('操作の識別子で始まり、閲覧者と利用者の状態ごとに別のキーにする', () => {
    const guest = inquiryContactQueryOptions(null).queryKey;
    const active = inquiryContactQueryOptions(VIEWER).queryKey;
    const suspended = inquiryContactQueryOptions({
      ...VIEWER,
      status: 'SUSPENDED',
    }).queryKey;
    const other = inquiryContactQueryOptions({
      ...VIEWER,
      id: '01JC0VIEWER0000000000000001',
    }).queryKey;

    expect(guest[0]).toBe(documentIdOf(ClientInquiryContactFormDocument));
    expect(new Set([guest, active, suspended, other].map(String)).size).toBe(4);
  });
});

describe('loadContactPage', () => {
  test('ログイン中は、閲覧者とページの位置のキーのキャッシュにあれば、フォームも一覧も取得し直さずに使う', async () => {
    const queryClient = new QueryClient();
    const formKey = inquiryContactQueryOptions(VIEWER).queryKey;
    const listKey = myInquiriesQueryOptions(VIEWER.id, 'cursor-2').queryKey;
    queryClient.setQueryData(formKey, RESULT);
    queryClient.setQueryData(listKey, MY_INQUIRIES);

    await loadContactPage({
      context: { queryClient, viewer: VIEWER },
      deps: { after: 'cursor-2' },
    });

    expect(queryClient.getQueryState(formKey)?.dataUpdateCount).toBe(1);
    expect(queryClient.getQueryState(listKey)?.dataUpdateCount).toBe(1);
  });

  test('未ログインでは、自分の問い合わせの一覧を取得しない', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(inquiryContactQueryOptions(null).queryKey, {
      ...RESULT,
      inquiryComposer: null,
    });

    await loadContactPage({
      context: { queryClient, viewer: null },
      deps: { after: 'cursor-2' },
    });

    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: [documentIdOf(ClientMyInquiriesDocument)] }),
    ).toStrictEqual([]);
  });
});

describe('toMyInquiryPage', () => {
  test('応答の順のまま、ステータスを表示部品の値にして行に必要な項目を取り出す', () => {
    expect(toMyInquiryPage(MY_INQUIRIES)).toStrictEqual({
      items: [
        {
          id: '01JC0INQVRY000000000000002',
          categoryName: '不具合の報告',
          status: 'in_progress',
          createdAt: '2026-11-04T01:00:00.000Z',
          lastMessageAt: '2026-11-05T02:30:00.000Z',
        },
        {
          id: '01JC0INQVRY000000000000001',
          categoryName: 'その他',
          status: 'open',
          createdAt: '2026-11-03T01:00:00.000Z',
          lastMessageAt: '2026-11-03T01:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-2',
    });
  });

  test.each([
    ['RESOLVED', 'resolved'],
    ['REJECTED', 'rejected'],
  ] as const)('ステータス%sを%sにする', (status, expected) => {
    const [item] = toMyInquiryPage({
      myInquiries: {
        items: MY_INQUIRIES.myInquiries.items.map((each) => ({
          ...each,
          status,
        })),
        nextCursor: null,
      },
    }).items;

    expect(item?.status).toBe(expected);
  });
});

describe('myInquiriesQueryOptions', () => {
  test('操作の識別子とページの位置で始まり、閲覧者ごとに別のキーにする', () => {
    const first = myInquiriesQueryOptions(VIEWER.id, undefined).queryKey;
    const second = myInquiriesQueryOptions(VIEWER.id, 'cursor-2').queryKey;
    const other = myInquiriesQueryOptions(
      '01JC0VIEWER0000000000000001',
      undefined,
    ).queryKey;

    expect(first.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientMyInquiriesDocument),
      {},
    ]);
    expect(second.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientMyInquiriesDocument),
      { after: 'cursor-2' },
    ]);
    expect(
      new Set([first, second, other].map((key) => JSON.stringify(key))).size,
    ).toBe(3);
  });
});
