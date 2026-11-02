import { describe, expect, test } from 'bun:test';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientViewerDocument,
  type ClientViewerQuery,
} from './generated/graphql.ts';
import { toClientViewer, viewerQueryOptions } from './viewer.ts';

const SIGNED_IN: ClientViewerQuery = {
  viewer: {
    id: '01JC0VIEWER0000000000000000',
    handle: 'pitch_maker',
    nickname: 'ピッチの作り手',
    emailVerified: false,
    status: 'SUSPENDED',
    totpEnabled: true,
  },
};

describe('toClientViewer', () => {
  test('ログイン中の利用者の項目を、ヘッダーと判定に使う形で取り出す', () => {
    expect(toClientViewer(SIGNED_IN)).toStrictEqual({
      id: '01JC0VIEWER0000000000000000',
      handle: 'pitch_maker',
      nickname: 'ピッチの作り手',
      emailVerified: false,
      status: 'SUSPENDED',
      totpEnabled: true,
    });
  });

  test('未ログインの応答はnullにする', () => {
    expect(toClientViewer({ viewer: null })).toBeNull();
  });
});

describe('viewerQueryOptions', () => {
  test('ログイン中の利用者の操作と空の変数をキーにする', () => {
    expect([...viewerQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientViewerDocument, {}),
    ]);
  });
});
