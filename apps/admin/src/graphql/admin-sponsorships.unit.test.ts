import { describe, expect, test } from 'bun:test';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminSponsorshipsQueryOptions,
  adminSponsorshipTerminationPreviewQueryOptions,
  toAdminSponsorshipPage,
  toSponsorshipStatus,
  toSponsorshipTier,
} from './admin-sponsorships.ts';
import {
  AdminSponsorshipsDocument,
  AdminSponsorshipTerminationPreviewDocument,
} from './generated/graphql.ts';

describe('adminSponsorshipsQueryOptions', () => {
  test('申込の一覧の操作と、絞り込み・件数・カーソルの変数をキーにする', () => {
    const variables = {
      filter: { status: 'ACTIVE', tier: 'GOLD' },
      first: 50,
      after: 'cursor-2',
    } as const;

    expect([
      ...adminSponsorshipsQueryOptions(variables).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminSponsorshipsDocument, variables),
    ]);
  });
});

describe('adminSponsorshipTerminationPreviewQueryOptions', () => {
  test('強制終了の確認の操作と申込のIDだけの変数をキーにする', () => {
    const id = '01JBZ8Y4T5V6W7X8Y9Z0A1B2C3';

    expect([
      ...adminSponsorshipTerminationPreviewQueryOptions(id).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminSponsorshipTerminationPreviewDocument, { id }),
    ]);
  });
});

describe('toSponsorshipStatus・toSponsorshipTier', () => {
  test('GraphQLの大文字の列挙を、表示名を引く共用部品の値へ写す', () => {
    expect(
      (
        [
          'PENDING_PAYMENT',
          'SCHEDULED',
          'ACTIVE',
          'PAUSED',
          'ENDED',
          'TERMINATED',
        ] as const
      ).map(toSponsorshipStatus),
    ).toStrictEqual([
      'pending_payment',
      'scheduled',
      'active',
      'paused',
      'ended',
      'terminated',
    ]);
    expect(
      (['LEGEND', 'GOLD', 'SILVER'] as const).map(toSponsorshipTier),
    ).toStrictEqual(['legend', 'gold', 'silver']);
  });
});

describe('toAdminSponsorshipPage', () => {
  test('応答から申込の一覧のページを取り出す', () => {
    const page = {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };

    expect(toAdminSponsorshipPage({ adminSponsorships: page })).toBe(page);
  });
});
