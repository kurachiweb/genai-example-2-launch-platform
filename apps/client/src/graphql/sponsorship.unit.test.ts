import { describe, expect, expectTypeOf, test } from 'bun:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import { SPONSORSHIP_STATUSES } from '../../common-lib/sponsorship/sponsorship-status.ts';
import { SPONSORSHIP_TIERS } from '../../common-lib/sponsorship/sponsorship-tiers.ts';
import {
  ClientActiveSponsorshipCountDocument,
  ClientApplySponsorshipDocument,
  ClientMySponsorshipsDocument,
  type ClientMySponsorshipsQuery,
  ClientResumeSponsorshipCheckoutDocument,
  type ClientSponsoredPlacementsQuery,
  ClientSponsorshipOfferDocument,
  type ClientSponsorshipOfferQuery,
  ClientSponsorshipPeriodWindowDocument,
  type ClientSponsorshipPeriodWindowQuery,
  type SponsoredAdFieldsFragment,
} from './generated/graphql.ts';
import {
  activeSponsorshipCountQueryOptions,
  applySponsorshipMutationOptions,
  loadMySponsorships,
  MY_SPONSORSHIPS_PAGE_SIZE,
  mySponsorshipsQueryOptions,
  resumeSponsorshipCheckoutMutationOptions,
  sponsorshipOfferQueryOptions,
  sponsorshipPeriodWindowQueryOptions,
  toGraphQLSponsorshipTier,
  toSponsorshipStatus,
  toSponsorshipTier,
} from './sponsorship.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const OTHER_VIEWER: ClientViewer = {
  ...VIEWER,
  id: '01JC0VIEWER0000000000000001',
};

const PRODUCT_ID = '01JD0PR0DVCT000000000000000';

const OTHER_PRODUCT_ID = '01JD0PR0DVCT000000000000001';

const SPONSORSHIP_ID = '01JD0SP0NS0R000000000000000';

const PURCHASE_ID = '01JD0PVRCHASE00000000000000';

interface SentRequest {
  readonly documentId: string;
  readonly variables: unknown;
}

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で実行し、APIへ送った識別子と変数を読み取る
const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  respond: () => Promise<Response>,
) => {
  const api = recordingApi(respond);
  const queryClient = new QueryClient();
  let result: unknown;
  await runInStartRequest({
    context: renderContextOf({ api, reported: [] }),
    render: async () => {
      result = await run(queryClient);
      return htmlResponse();
    },
  });
  const sent = await Promise.all(
    api.requests.map((request) => request.json() as Promise<SentRequest>),
  );
  return { result, sent, queryClient };
};

const respondWith = (data: unknown) => () =>
  Promise.resolve(graphqlResponse({ data }));

const keysAreDistinct = (keys: readonly (readonly unknown[])[]): boolean =>
  new Set(keys.map((key) => JSON.stringify(key))).size === keys.length;

type MySponsorshipNode =
  ClientMySponsorshipsQuery['mySponsorships']['nodes'][number];

const MY_SPONSORSHIP: MySponsorshipNode = {
  id: SPONSORSHIP_ID,
  product: {
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    logo: null,
    listed: true,
  },
  tier: 'GOLD',
  startsOn: '2026-12-01',
  endsOn: '2026-12-07',
  days: 7,
  amountPaid: { amount: 7000, currency: 'usd' },
  status: 'SCHEDULED',
  terminatedOn: null,
  terminationReason: null,
  terminationRefund: null,
  displayStopRefund: null,
  canResume: false,
  createdAt: '2026-11-25T20:00:00.000Z',
};

const mySponsorshipsPage = (
  nodes: readonly MySponsorshipNode[],
  endCursor: string | null,
  hasNextPage: boolean,
): ClientMySponsorshipsQuery => ({
  mySponsorships: {
    nodes: [...nodes],
    pageInfo: { endCursor, hasNextPage },
    nextDayStartsAt: '2026-11-26T08:00:00.000Z',
  },
});

const FIRST_PAGE = mySponsorshipsPage([MY_SPONSORSHIP], 'cursor-1', true);

const nextPageParamOf = (page: ClientMySponsorshipsQuery) =>
  mySponsorshipsQueryOptions(VIEWER.id).getNextPageParam(page, [page], null, [
    null,
  ]);

describe('列挙の値の写し', () => {
  test('ティアはGraphQLの大文字の値と表示名を引く共用部品の値を相互に写す', () => {
    expect(SPONSORSHIP_TIERS.map(toGraphQLSponsorshipTier)).toStrictEqual([
      'LEGEND',
      'GOLD',
      'SILVER',
    ]);
    expect(
      (['LEGEND', 'GOLD', 'SILVER'] as const).map(toSponsorshipTier),
    ).toStrictEqual([...SPONSORSHIP_TIERS]);
  });

  test('掲載状況はGraphQLの大文字の値を表示名を引く共用部品の値へ写す', () => {
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
    ).toStrictEqual([...SPONSORSHIP_STATUSES]);
  });
});

describe('sponsorshipOfferQueryOptions', () => {
  test('申込の対象のプロダクトが閲覧者ごとに違うため、変数の無いキーの後に閲覧者のIDか未ログインの印を加える', () => {
    expect([...sponsorshipOfferQueryOptions(VIEWER).queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientSponsorshipOfferDocument, {}),
      VIEWER.id,
    ]);
    expect([...sponsorshipOfferQueryOptions(null).queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientSponsorshipOfferDocument, {}),
      'guest',
    ]);
    expect(
      keysAreDistinct([
        sponsorshipOfferQueryOptions(VIEWER).queryKey,
        sponsorshipOfferQueryOptions(OTHER_VIEWER).queryKey,
        sponsorshipOfferQueryOptions(null).queryKey,
      ]),
    ).toBe(true);
  });

  test('変数を付けずに照会を送り、価格の無いティアと未ログインのnullもそのまま返す', async () => {
    const data: ClientSponsorshipOfferQuery = {
      sponsorshipOffer: {
        tiers: [
          { tier: 'LEGEND', unitPrice: { amount: 3000, currency: 'usd' } },
          { tier: 'GOLD', unitPrice: null },
          { tier: 'SILVER', unitPrice: { amount: 300, currency: 'usd' } },
        ],
        eligibleProducts: null,
      },
    };

    const { result, sent } = await runThroughApi(
      (queryClient) => queryClient.query(sponsorshipOfferQueryOptions(null)),
      respondWith(data),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientSponsorshipOfferDocument),
        variables: {},
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('sponsorshipPeriodWindowQueryOptions', () => {
  test('本人のプロダクトの範囲のため、プロダクト・ティアの変数のキーの後に閲覧者のIDを加え、開始日を選ぶまでは開始日を変数に含めない', () => {
    expect([
      ...sponsorshipPeriodWindowQueryOptions(VIEWER, {
        productId: PRODUCT_ID,
        tier: 'gold',
        startsOn: null,
      }).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientSponsorshipPeriodWindowDocument, {
        productId: PRODUCT_ID,
        tier: 'GOLD',
      }),
      VIEWER.id,
    ]);
    expect([
      ...sponsorshipPeriodWindowQueryOptions(VIEWER, {
        productId: PRODUCT_ID,
        tier: 'gold',
        startsOn: '2026-12-01',
      }).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientSponsorshipPeriodWindowDocument, {
        productId: PRODUCT_ID,
        tier: 'GOLD',
        startsOn: '2026-12-01',
      }),
      VIEWER.id,
    ]);
  });

  test('プロダクト・ティア・開始日・閲覧者ごとに別のキーにする', () => {
    const base = {
      productId: PRODUCT_ID,
      tier: 'gold',
      startsOn: null,
    } as const;

    expect(
      keysAreDistinct([
        sponsorshipPeriodWindowQueryOptions(VIEWER, base).queryKey,
        sponsorshipPeriodWindowQueryOptions(VIEWER, {
          ...base,
          productId: OTHER_PRODUCT_ID,
        }).queryKey,
        sponsorshipPeriodWindowQueryOptions(VIEWER, { ...base, tier: 'legend' })
          .queryKey,
        sponsorshipPeriodWindowQueryOptions(VIEWER, {
          ...base,
          startsOn: '2026-12-01',
        }).queryKey,
        sponsorshipPeriodWindowQueryOptions(VIEWER, {
          ...base,
          startsOn: '2026-12-02',
        }).queryKey,
        sponsorshipPeriodWindowQueryOptions(OTHER_VIEWER, base).queryKey,
      ]),
    ).toBe(true);
  });

  test('ティアをGraphQLの値にして照会を送り、終了日の範囲のnullもそのまま返す', async () => {
    const data: ClientSponsorshipPeriodWindowQuery = {
      sponsorshipPeriodWindow: {
        businessToday: '2026-11-25',
        nextDayStartsAt: '2026-11-26T08:00:00.000Z',
        start: {
          earliest: '2026-11-25',
          latest: '2027-11-25',
          unavailable: [
            { from: '2026-12-01', to: '2026-12-07', reason: 'OVERLAP' },
          ],
        },
        end: null,
      },
    };

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(
          sponsorshipPeriodWindowQueryOptions(VIEWER, {
            productId: PRODUCT_ID,
            tier: 'silver',
            startsOn: '2026-12-03',
          }),
        ),
      respondWith(data),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientSponsorshipPeriodWindowDocument),
        variables: {
          productId: PRODUCT_ID,
          tier: 'SILVER',
          startsOn: '2026-12-03',
        },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('mySponsorshipsQueryOptions', () => {
  test('操作の識別子と1ページの件数で始まり、閲覧者ごとに別のキーにする', () => {
    const mine = mySponsorshipsQueryOptions(VIEWER.id).queryKey;

    expect([...mine]).toStrictEqual([
      ...graphqlQueryKey(ClientMySponsorshipsDocument, {
        first: MY_SPONSORSHIPS_PAGE_SIZE,
      }),
      VIEWER.id,
    ]);
    expect(
      keysAreDistinct([
        mine,
        mySponsorshipsQueryOptions(OTHER_VIEWER.id).queryKey,
      ]),
    ).toBe(true);
  });

  test('1ページは20件で、最初のページはカーソルを持たない', () => {
    expect(MY_SPONSORSHIPS_PAGE_SIZE).toBe(20);
    expect(mySponsorshipsQueryOptions(VIEWER.id).initialPageParam).toBeNull();
  });

  test('続きがあれば最後の申込のカーソルを次のページの位置にする', () => {
    expect(nextPageParamOf(FIRST_PAGE)).toBe('cursor-1');
  });

  test.each([
    ['続きが無い', mySponsorshipsPage([MY_SPONSORSHIP], 'cursor-1', false)],
    ['カーソルが無い', mySponsorshipsPage([], null, true)],
  ])('%sなら次のページを持たない', (_case, page) => {
    expect(nextPageParamOf(page)).toBeUndefined();
  });

  test('最初のページは件数だけ、続きのページは件数とカーソルを変数にして実行する', async () => {
    const { sent } = await runThroughApi(async (queryClient) => {
      const options = mySponsorshipsQueryOptions(VIEWER.id);
      await queryClient.infiniteQuery(options);
      return queryClient.infiniteQuery({ ...options, pages: 2 });
    }, respondWith(FIRST_PAGE));

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientMySponsorshipsDocument),
        variables: { first: MY_SPONSORSHIPS_PAGE_SIZE },
      },
      {
        documentId: documentIdOf(ClientMySponsorshipsDocument),
        variables: { first: MY_SPONSORSHIPS_PAGE_SIZE },
      },
      {
        documentId: documentIdOf(ClientMySponsorshipsDocument),
        variables: { first: MY_SPONSORSHIPS_PAGE_SIZE, after: 'cursor-1' },
      },
    ]);
  });
});

describe('loadMySponsorships', () => {
  test('最初のページを読み、続きは読まない', async () => {
    const { result, sent } = await runThroughApi(async (queryClient) => {
      await loadMySponsorships({ context: { queryClient, viewer: VIEWER } });
      return queryClient.getQueryData(
        mySponsorshipsQueryOptions(VIEWER.id).queryKey,
      );
    }, respondWith(FIRST_PAGE));

    expect(result).toStrictEqual({ pages: [FIRST_PAGE], pageParams: [null] });
    expect(sent).toHaveLength(1);
  });

  test('取得に失敗しても、一覧の中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadMySponsorships({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(mySponsorshipsQueryOptions(VIEWER.id).queryKey)
        ?.status,
    ).toBe('error');
  });
});

describe('activeSponsorshipCountQueryOptions', () => {
  test('本人のプロダクトの件数のため、プロダクトのハンドルの変数のキーの後に閲覧者のIDを加える', () => {
    expect([
      ...activeSponsorshipCountQueryOptions(VIEWER, 'pitch-notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientActiveSponsorshipCountDocument, {
        productHandle: 'pitch-notes',
      }),
      VIEWER.id,
    ]);
    expect(
      keysAreDistinct([
        activeSponsorshipCountQueryOptions(VIEWER, 'pitch-notes').queryKey,
        activeSponsorshipCountQueryOptions(VIEWER, 'goal-board').queryKey,
        activeSponsorshipCountQueryOptions(OTHER_VIEWER, 'pitch-notes')
          .queryKey,
      ]),
    ).toBe(true);
  });

  test('プロダクトのハンドルを変数にして照会を送り、件数を返す', async () => {
    const data = { activeSponsorshipCount: 2 };

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(
          activeSponsorshipCountQueryOptions(VIEWER, 'pitch-notes'),
        ),
      respondWith(data),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientActiveSponsorshipCountDocument),
        variables: { productHandle: 'pitch-notes' },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('applySponsorshipMutationOptions', () => {
  test('変更のキーは操作の識別子だけにする', () => {
    expect(applySponsorshipMutationOptions().mutationKey).toStrictEqual([
      documentIdOf(ClientApplySponsorshipDocument),
    ]);
  });

  test('申込の入力を変数にして送り、購入のIDを返す', async () => {
    const data = { applySponsorship: { purchaseId: PURCHASE_ID } };
    const input = {
      productId: PRODUCT_ID,
      tier: 'GOLD',
      startsOn: '2026-12-01',
      endsOn: '2026-12-07',
    } as const;

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        new MutationObserver(
          queryClient,
          applySponsorshipMutationOptions(),
        ).mutate({ variables: { input } }),
      respondWith(data),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientApplySponsorshipDocument),
        variables: { input },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('resumeSponsorshipCheckoutMutationOptions', () => {
  test('変更のキーは操作の識別子だけにする', () => {
    expect(
      resumeSponsorshipCheckoutMutationOptions().mutationKey,
    ).toStrictEqual([documentIdOf(ClientResumeSponsorshipCheckoutDocument)]);
  });

  test('申込のIDを変数にして決済の再開を送り、購入のIDを返す', async () => {
    const data = { resumeSponsorshipCheckout: { purchaseId: PURCHASE_ID } };

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        new MutationObserver(
          queryClient,
          resumeSponsorshipCheckoutMutationOptions(),
        ).mutate({ variables: { id: SPONSORSHIP_ID } }),
      respondWith(data),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientResumeSponsorshipCheckoutDocument),
        variables: { id: SPONSORSHIP_ID },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('照会の結果とフラグメントの型', () => {
  test('3つのティアの広告は、広告のカードが受けるSponsoredAdFieldsのフラグメントの型と一致する', () => {
    type Placements = ClientSponsoredPlacementsQuery['sponsoredPlacements'];

    expectTypeOf<
      Placements['legend'][number]
    >().toEqualTypeOf<SponsoredAdFieldsFragment>();
    expectTypeOf<
      Placements['gold'][number]
    >().toEqualTypeOf<SponsoredAdFieldsFragment>();
    expectTypeOf<
      Placements['silver'][number]
    >().toEqualTypeOf<SponsoredAdFieldsFragment>();
  });
});
