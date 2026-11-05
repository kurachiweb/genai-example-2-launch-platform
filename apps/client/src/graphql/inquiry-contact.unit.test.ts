import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientInquiryContactFormDocument,
  type ClientInquiryContactFormQuery,
} from './generated/graphql.ts';
import {
  inquiryContactQueryOptions,
  loadContactPage,
  toInquiryContactFormView,
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
  test('閲覧者のキーのキャッシュにあれば取得し直さずに使う', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      inquiryContactQueryOptions(VIEWER).queryKey,
      RESULT,
    );

    await loadContactPage({ context: { queryClient, viewer: VIEWER } });

    expect(
      queryClient.getQueryState(inquiryContactQueryOptions(VIEWER).queryKey)
        ?.dataUpdateCount,
    ).toBe(1);
  });
});
