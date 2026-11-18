import { describe, expect, test } from 'bun:test';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminSponsorshipsQueryOptions,
  adminSponsorshipTerminationPreviewQueryOptions,
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
