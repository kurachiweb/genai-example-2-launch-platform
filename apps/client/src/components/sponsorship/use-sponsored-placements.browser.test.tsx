import { Suspense } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import { graphqlQueryKey } from '../../../lib/utilities/graphql/persisted-document.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  ClientSponsoredPlacementsDocument,
  type ClientSponsoredPlacementsQuery,
  type SponsorshipTier,
} from '../../graphql/generated/graphql.ts';
import {
  sponsoredPlacementsQueryOptions,
  useSponsoredPlacements,
} from './use-sponsored-placements.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const SPONSORED_PLACEMENTS_STALE_TIME_MS = 60_000;

const adOf = (id: string, tier: SponsorshipTier, productName: string) => ({
  id,
  tier,
  productName,
  tagline: null,
  websiteUrl: null,
  logo: null,
});

// 照会のたびに無作為に変わる並びを、IDの昇順とは異なる順で表す
const PLACEMENTS: ClientSponsoredPlacementsQuery = {
  sponsoredPlacements: {
    legend: [adOf('01JLEGEND00000000000000002', 'LEGEND', 'Legend B')],
    gold: [
      adOf('01JGOLD0000000000000000003', 'GOLD', 'Gold C'),
      adOf('01JGOLD0000000000000000001', 'GOLD', 'Gold A'),
      adOf('01JGOLD0000000000000000002', 'GOLD', 'Gold B'),
    ],
    silver: [
      adOf('01JSILVER00000000000000002', 'SILVER', 'Silver B'),
      adOf('01JSILVER00000000000000001', 'SILVER', 'Silver A'),
    ],
  },
};

const respondWithPlacements = () => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientSponsoredPlacementsDocument
      ? Promise.resolve({ ok: true, data: PLACEMENTS })
      : Promise.reject(new Error('想定外の操作です。')),
  );
};

const placementCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientSponsoredPlacementsDocument,
  );

function GoldNames({ label }: { readonly label: string }) {
  const { gold } = useSponsoredPlacements();
  return (
    <ol aria-label={label}>
      {gold.map(({ id, productName }) => (
        <li key={id}>{productName}</li>
      ))}
    </ol>
  );
}

function SilverNames() {
  const { silver } = useSponsoredPlacements();
  return (
    <ol aria-label="Silverの並び">
      {silver.map(({ id, productName }) => (
        <li key={id}>{productName}</li>
      ))}
    </ol>
  );
}

const namesIn = (label: string): readonly (string | null)[] =>
  Array.from(
    document.querySelectorAll(`ol[aria-label="${label}"] li`),
    (item) => item.textContent,
  );

afterEach(() => {
  executeGraphQL.mockReset();
});

describe('sponsoredPlacementsQueryOptions', () => {
  test('広告の照会は変数を持たない共通の取得のキーと60秒の鮮度を持つ', () => {
    const options = sponsoredPlacementsQueryOptions();

    expect(options.queryKey).toEqual(
      graphqlQueryKey(ClientSponsoredPlacementsDocument, {}),
    );
    expect(options.staleTime).toBe(SPONSORED_PLACEMENTS_STALE_TIME_MS);
  });
});

describe('useSponsoredPlacements', () => {
  test('同じページの複数の部品は、それぞれのSuspenseの境界の中でも1回の取得の同じ並びを使う', async () => {
    respondWithPlacements();

    await renderInRouter(
      <>
        <Suspense fallback={null}>
          <GoldNames label="一覧の横のGold" />
        </Suspense>
        <Suspense fallback={null}>
          <GoldNames label="一覧の差し込みのGold" />
        </Suspense>
        <Suspense fallback={null}>
          <SilverNames />
        </Suspense>
      </>,
    );

    await expect
      .element(page.getByRole('list', { name: '一覧の横のGold' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('list', { name: '一覧の差し込みのGold' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('list', { name: 'Silverの並び' }))
      .toBeInTheDocument();

    expect(namesIn('一覧の横のGold')).toEqual(['Gold C', 'Gold A', 'Gold B']);
    expect(namesIn('一覧の差し込みのGold')).toEqual(namesIn('一覧の横のGold'));
    expect(namesIn('Silverの並び')).toEqual(['Silver B', 'Silver A']);
    expect(placementCalls()).toHaveLength(1);
  });

  test.each<[string, number, number]>([
    ['アプリの既定の鮮度を過ぎても60秒の内なら取得し直さない', 45_000, 0],
    ['60秒を過ぎていれば取得し直す', 61_000, 1],
  ])(
    '後から表示した部品は先に取得した並びを描き、前の取得から%s',
    async (_label, elapsedMs, expectedCalls) => {
      respondWithPlacements();
      const context = createPageRouterContext('local');
      context.queryClient.setQueryData(
        sponsoredPlacementsQueryOptions().queryKey,
        PLACEMENTS,
        { updatedAt: Date.now() - elapsedMs },
      );

      await renderInRouter(
        <Suspense fallback={null}>
          <GoldNames label="後から表示したGold" />
        </Suspense>,
        { context },
      );
      await expect
        .element(page.getByRole('list', { name: '後から表示したGold' }))
        .toBeInTheDocument();

      expect(namesIn('後から表示したGold')).toEqual([
        'Gold C',
        'Gold A',
        'Gold B',
      ]);
      await expect.poll(() => placementCalls().length).toBe(expectedCalls);
    },
  );
});
