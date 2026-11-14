import { describe, expect, test, vi } from 'vitest';

import { teamColorIndexOf } from '../../../../../common-lib/match/team-colors.ts';
import { STARTS_AT } from '../../../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  insertUpvotes,
  type MatchFixture,
  matchIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  insertProduct,
  insertUser,
  productIdOf,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  fetchMatchViews,
  installMatchGraphQLTest,
  issueMatchUserSession,
} from '../../../../../test/support/match-graphql-operations.ts';
import { DirectoryMatchViewReader } from '../../../../application/match/match-view-reader.ts';
import { DEFAULT_LOADER_MAX_BATCH_SIZE } from '../../loaders.ts';

installMatchGraphQLTest();

const OWNER = 1;

const VOTER = 2;

function unlinkedMatch(index: number): MatchFixture {
  return {
    index,
    entries: [
      { index: index * 10 + 1, launch: null, product: null, owner: null },
      { index: index * 10 + 2, launch: null, product: null, owner: null },
    ],
  };
}

describe('matchViewLoader', () => {
  test('後続のモジュールが自分の項目からマッチを返し、閲覧者のUpvoteを添え、見つからないマッチはnullにする', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertUser(VOTER, { emailVerifiedAt: T0 });
    await insertProduct(1, OWNER);
    await insertMatches([
      {
        index: 1,
        columns: { startedAt: STARTS_AT },
        entries: [
          { index: 11, launch: null, product: 1, owner: OWNER },
          {
            index: 12,
            launch: null,
            product: null,
            owner: null,
            columns: { upvoteCount: 1 },
          },
        ],
      },
    ]);
    await insertUpvotes([
      { index: 1, match: 1, entry: 12, user: VOTER, upvotedAt: STARTS_AT },
    ]);
    const token = await issueMatchUserSession(VOTER);

    const response = await fetchMatchViews([matchIdOf(1), matchIdOf(9)], {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.matchViews).toEqual([
      expect.objectContaining({
        id: matchIdOf(1),
        phase: 'LIVE',
        entries: [
          expect.objectContaining({
            id: entryIdOf(11),
            product: expect.objectContaining({ handle: 'product1' }) as never,
            colorIndex: teamColorIndexOf(productIdOf(1)),
          }),
          expect.objectContaining({
            id: entryIdOf(12),
            product: null,
            upvoteCount: 1,
            colorIndex: 0,
          }),
        ],
        viewerUpvotedEntryId: entryIdOf(12),
        viewerRestriction: null,
      }),
      null,
    ]);
  });

  test('一括読み込みは件数の上限ごとに分けてマッチの表示を引く', async () => {
    const count = DEFAULT_LOADER_MAX_BATCH_SIZE + 1;
    const indexes = Array.from({ length: count }, (_, index) => index + 1);
    await insertMatches(indexes.map(unlinkedMatch));
    const findViews = vi.spyOn(DirectoryMatchViewReader.prototype, 'findViews');

    const response = await fetchMatchViews(indexes.map(matchIdOf));

    expect(response.errors).toBeUndefined();
    expect(response.data?.matchViews.map((match) => match?.id)).toEqual(
      indexes.map(matchIdOf),
    );
    expect(
      findViews.mock.calls.map(([input]) => input.matchIds.length),
    ).toEqual([DEFAULT_LOADER_MAX_BATCH_SIZE, 1]);
    expect(findViews.mock.calls.map(([input]) => input.viewer)).toEqual([
      undefined,
      undefined,
    ]);
  });
});
