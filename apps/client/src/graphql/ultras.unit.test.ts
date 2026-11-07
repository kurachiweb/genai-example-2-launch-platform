import { describe, expect, test } from 'bun:test';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientUltrasOfferDocument,
  ClientViewerUltrasDocument,
} from './generated/graphql.ts';
import {
  toUltrasPlanStatus,
  ultrasOfferQueryOptions,
  viewerUltrasQueryOptions,
} from './ultras.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

describe('ultrasOfferQueryOptions', () => {
  test('操作の識別子と空の変数だけのキーを持ち、閲覧者によらず1つの取得にまとめる', () => {
    expect([...ultrasOfferQueryOptions().queryKey]).toStrictEqual([
      documentIdOf(ClientUltrasOfferDocument),
      {},
    ]);
  });
});

describe('viewerUltrasQueryOptions', () => {
  test('操作の識別子と空の変数で始まり、閲覧者ごとと未ログインで別のキーにする', () => {
    const own = viewerUltrasQueryOptions(VIEWER).queryKey;
    const other = viewerUltrasQueryOptions({
      ...VIEWER,
      id: '01JC0VIEWER0000000000000001',
    }).queryKey;
    const guest = viewerUltrasQueryOptions(null).queryKey;

    expect(own.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientViewerUltrasDocument),
      {},
    ]);
    expect(
      new Set([own, other, guest].map((key) => JSON.stringify(key))).size,
    ).toBe(3);
  });

  test('同じ閲覧者は、停止の状態が変わっても同じキーにする', () => {
    expect(viewerUltrasQueryOptions(VIEWER).queryKey).toStrictEqual(
      viewerUltrasQueryOptions({ ...VIEWER, status: 'SUSPENDED' }).queryKey,
    );
  });
});

describe('toUltrasPlanStatus', () => {
  test.each([
    ['ACTIVE', 'active'],
    ['PAST_DUE', 'past_due'],
    ['CANCELED', 'canceled'],
    ['ENDED', 'ended'],
  ] as const)(
    'GraphQLの加入状態%sを共用部品の加入状態%sに写す',
    (graphqlStatus, status) => {
      expect(toUltrasPlanStatus(graphqlStatus)).toBe(status);
    },
  );
});
