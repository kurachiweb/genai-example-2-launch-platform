import { describe, expect, test } from 'bun:test';

import type { AwardGroup } from '../../../lib/core/product/launch-summary.ts';
import type { ProductHandleResolution } from '../../../lib/core/product/ports.ts';
import { DirectoryProductPageReader } from './product-page-reader.ts';
import {
  createFakePorts,
  currentResolution,
  date,
  detailOf,
  type FakeOptions,
  launchOf,
  matchOf,
  NOW,
  OPPONENT_ID,
  OTHER_OPPONENT_ID,
  OWNER_ID,
  PRODUCT_HANDLE,
  PRODUCT_ID,
  STRANGER_ID,
  summaryOf,
  viewerOf,
} from './testing/product-page-fakes.ts';

function setup(options: FakeOptions = {}) {
  const ports = createFakePorts(options);
  const reader = new DirectoryProductPageReader(
    ports.products,
    ports.matches,
    ports.highlights,
  );
  return { reader, calls: ports.calls };
}

const read = (
  reader: DirectoryProductPageReader,
  options: { readonly handle?: string; readonly viewerId?: string } = {},
) =>
  reader.read({
    handle: options.handle ?? PRODUCT_HANDLE,
    viewer:
      options.viewerId === undefined ? undefined : viewerOf(options.viewerId),
    now: NOW,
  });

const pageOf = async (
  promise: ReturnType<DirectoryProductPageReader['read']>,
) => {
  const result = await promise;
  if (result.kind !== 'page') {
    throw new Error(`ページを返していません: ${result.kind}`);
  }
  return result.view;
};

describe('ProductPageReader.read: 公開範囲', () => {
  test.each([
    ['空文字', ''],
    ['使えない文字', 'my product'],
    ['先頭の記号', '-product'],
    ['51文字', 'a'.repeat(51)],
  ])(
    'ハンドルが形式に合わない(%s)なら照会をせずにnot-foundを返す',
    async (_label, handle) => {
      const { reader, calls } = setup();

      const result = await read(reader, { handle });

      expect(result).toEqual({ kind: 'not-found' });
      expect(calls.resolveHandle).toEqual([]);
      expect(calls.findDetail).toEqual([]);
    },
  );

  test('ハンドルの形式の上限の50文字は照会する', async () => {
    const { reader, calls } = setup({ resolution: { kind: 'none' } });

    await read(reader, { handle: 'a'.repeat(50) });

    expect(calls.resolveHandle).toEqual(['a'.repeat(50)]);
  });

  const NOT_FOUND_CASES: readonly [
    string,
    ProductHandleResolution,
    string | undefined,
  ][] = [
    ['存在しない', { kind: 'none' }, OWNER_ID],
    [
      '可視でない(本人)',
      currentResolution(
        summaryOf(PRODUCT_ID, { visible: false, listed: false }),
      ),
      OWNER_ID,
    ],
    [
      '未掲載の他者のプロダクト',
      currentResolution(summaryOf(PRODUCT_ID, { listed: false })),
      STRANGER_ID,
    ],
    [
      '未掲載のプロダクトを未ログインで開く',
      currentResolution(summaryOf(PRODUCT_ID, { listed: false })),
      undefined,
    ],
    [
      '旧ハンドルで表示できない',
      {
        kind: 'previous',
        product: summaryOf(PRODUCT_ID, { visible: false, listed: false }),
      },
      STRANGER_ID,
    ],
  ];

  test.each(NOT_FOUND_CASES)(
    '%sならnot-foundを返し、詳細とローンチを読まない',
    async (_label, resolution, viewerId) => {
      const { reader, calls } = setup({ resolution });

      const result = await read(reader, { viewerId });

      expect(result).toEqual({ kind: 'not-found' });
      expect(calls.resolveHandle).toEqual([PRODUCT_HANDLE]);
      expect(calls.findDetail).toEqual([]);
      expect(calls.listLaunches).toEqual([]);
    },
  );

  test('表示できる旧ハンドルなら現在のハンドルへのredirectを返し、詳細を読まない', async () => {
    const { reader, calls } = setup({
      resolution: { kind: 'previous', product: summaryOf(PRODUCT_ID) },
    });

    const result = await read(reader, { handle: 'old-handle' });

    expect(result).toEqual({ kind: 'redirect', handle: PRODUCT_HANDLE });
    expect(calls.findDetail).toEqual([]);
  });

  test('本人の未掲載のプロダクトは本人向けの未掲載の表示で返す', async () => {
    const { reader } = setup({
      resolution: currentResolution(summaryOf(PRODUCT_ID, { listed: false })),
    });

    const view = await pageOf(read(reader, { viewerId: OWNER_ID }));

    expect(view.ownerView).toBe(true);
    expect(view.unlisted).toBe(true);
  });

  test('掲載中のプロダクトは他者にも表示し、本人向けの表示にしない', async () => {
    const { reader } = setup();

    const view = await pageOf(read(reader, { viewerId: STRANGER_ID }));

    expect(view.product).toEqual(summaryOf(PRODUCT_ID));
    expect(view.detail).toEqual(detailOf(PRODUCT_ID));
    expect(view.ownerView).toBe(false);
    expect(view.unlisted).toBe(false);
  });

  test('判定の後に論理削除されて詳細が読めなければnot-foundを返す', async () => {
    const { reader } = setup({ detail: undefined });

    expect(await read(reader)).toEqual({ kind: 'not-found' });
  });
});

describe('ProductPageReader.read: 照会の回数と取消のローンチ', () => {
  const launches = [
    launchOf('launch-3', {
      number: 0,
      launchDate: date('2026-11-08'),
      status: 'canceled',
      outcome: null,
      decidedAt: null,
    }),
    launchOf('launch-2', { number: 2, launchDate: date('2026-11-07') }),
    launchOf('launch-1', {
      number: 1,
      launchDate: date('2026-11-05'),
      outcome: 'lost',
    }),
  ];
  const matches = [
    matchOf({
      matchId: 'match-canceled',
      matchDate: '2026-11-08',
      sides: [
        {
          entryId: 'entry-canceled',
          launchId: 'launch-3',
          productId: PRODUCT_ID,
          upvoteCount: 50,
          result: 'won',
        },
        {
          entryId: 'entry-canceled-opponent',
          launchId: 'launch-x',
          productId: OTHER_OPPONENT_ID,
          upvoteCount: 1,
          result: 'lost',
        },
      ],
    }),
    matchOf({
      matchId: 'match-2',
      matchDate: '2026-11-07',
      sides: [
        {
          entryId: 'entry-2-opponent',
          launchId: 'launch-y',
          productId: OPPONENT_ID,
          upvoteCount: 3,
          result: 'lost',
        },
        {
          entryId: 'entry-2',
          launchId: 'launch-2',
          productId: PRODUCT_ID,
          upvoteCount: 9,
          result: 'won',
        },
      ],
    }),
    matchOf({
      matchId: 'match-1',
      matchDate: '2026-11-05',
      sides: [
        {
          entryId: 'entry-1',
          launchId: 'launch-1',
          productId: PRODUCT_ID,
          upvoteCount: 4,
          result: 'lost',
        },
        {
          entryId: 'entry-1-opponent',
          launchId: 'launch-z',
          productId: OPPONENT_ID,
          upvoteCount: 6,
          result: 'won',
        },
      ],
    }),
  ];

  const options: FakeOptions = {
    launches,
    matches,
    summaries: [summaryOf(OPPONENT_ID), summaryOf(OTHER_OPPONENT_ID)],
  };

  test('詳細・ローンチ・マッチ・対戦相手を各1回、処理の時刻で照会する', async () => {
    const { reader, calls } = setup(options);

    await read(reader);

    expect(calls.findDetail).toEqual([PRODUCT_ID]);
    expect(calls.listLaunches).toEqual([{ ids: [PRODUCT_ID], now: NOW }]);
    expect(calls.listByLaunches).toEqual([
      { ids: ['launch-2', 'launch-1'], now: NOW },
    ]);
    expect(calls.findSummaries).toEqual([
      { ids: [OPPONENT_ID], scope: 'not-deleted' },
    ]);
  });

  test('取消のローンチはブロックにも要約の供給元にも渡さない', async () => {
    const { reader, calls } = setup(options);

    const view = await pageOf(read(reader));

    expect(view.launches.map(({ launchId }) => launchId)).toEqual([
      'launch-2',
      'launch-1',
    ]);
    expect(
      calls.highlights.map(({ launches: passed, at }) => ({
        ids: passed.map(({ launchId }) => launchId),
        at,
      })),
    ).toEqual([{ ids: ['launch-2', 'launch-1'], at: NOW }]);
  });

  test('取消のローンチのマッチは通算成績にもマッチ履歴にも入らない', async () => {
    const { reader } = setup(options);

    const view = await pageOf(read(reader));

    const matchIds = view.launches.flatMap(({ rows }) =>
      rows.map(({ matchId }) => matchId),
    );
    expect(matchIds).not.toContain('match-canceled');
    expect(view.record).toEqual({
      firstLaunchDate: date('2026-11-05'),
      launchCount: 2,
      wins: 1,
      losses: 1,
    });
    expect([...view.opponents.keys()]).toEqual([OPPONENT_ID]);
  });

  test('相手の側も返るマッチから、ローンチごとに自分の側を行にする', async () => {
    const { reader } = setup(options);

    const view = await pageOf(read(reader));

    expect(
      view.launches.map(({ launchId, rows }) => ({
        launchId,
        rows: rows.map((row) => ({
          matchId: row.matchId,
          entryId: row.entryId,
          own: row.ownUpvoteCount,
          opponent: row.opponentUpvoteCount,
          result: row.result,
          opponentKind: row.opponent.kind,
        })),
      })),
    ).toEqual([
      {
        launchId: 'launch-2',
        rows: [
          {
            matchId: 'match-2',
            entryId: 'entry-2',
            own: 9,
            opponent: 3,
            result: 'won',
            opponentKind: 'listed',
          },
        ],
      },
      {
        launchId: 'launch-1',
        rows: [
          {
            matchId: 'match-1',
            entryId: 'entry-1',
            own: 4,
            opponent: 6,
            result: 'lost',
            opponentKind: 'listed',
          },
        ],
      },
    ]);
  });

  test('ローンチの要約と受賞は要約と受賞の読み取りの結果を使う', async () => {
    const awards: readonly AwardGroup[] = [
      { kind: 'week', count: 1, labels: ['Week 2026-W45 優勝'] },
    ];
    const { reader } = setup({
      ...options,
      highlights: {
        summaries: new Map([
          ['launch-2', { label: 'Week 優勝', inMatch: false }],
          ['launch-1', { label: '予選敗北', inMatch: false }],
        ]),
        awards: new Map([[PRODUCT_ID, awards]]),
      },
    });

    const view = await pageOf(read(reader));

    expect(view.launches.map(({ summary }) => summary)).toEqual([
      { label: 'Week 優勝', inMatch: false },
      { label: '予選敗北', inMatch: false },
    ]);
    expect(view.awards).toEqual(awards);
  });

  test('照会に失敗すれば部分的な履歴を返さずに失敗する', async () => {
    const ports = createFakePorts(options);
    const cause = new Error('D1に到達できません');
    const reader = new DirectoryProductPageReader(
      ports.products,
      {
        ...ports.matches,
        listByLaunches: () => Promise.reject(cause),
      },
      ports.highlights,
    );

    const failure = await read(reader).catch((error: unknown) => error);

    expect(failure).toBe(cause);
  });
});

describe('ProductPageReader.read: キックオフ済みの印', () => {
  test('キックオフ済みと、キックオフ済みで最も新しいローンチに印を付ける', async () => {
    const { reader } = setup({
      launches: [
        launchOf('launch-scheduled', {
          number: 4,
          launchDate: date('2026-11-20'),
          status: 'scheduled',
          outcome: null,
          decidedAt: null,
        }),
        launchOf('launch-paired', {
          number: 3,
          launchDate: date('2026-11-11'),
          status: 'paired',
          outcome: null,
          decidedAt: null,
        }),
        launchOf('launch-in-progress', {
          number: 2,
          launchDate: date('2026-11-10'),
          status: 'in_progress',
          outcome: null,
          decidedAt: null,
        }),
        launchOf('launch-finished', { number: 1 }),
      ],
    });

    const view = await pageOf(read(reader));

    expect(
      view.launches.map(({ launchId, kickedOff, latestKickedOff }) => ({
        launchId,
        kickedOff,
        latestKickedOff,
      })),
    ).toEqual([
      {
        launchId: 'launch-scheduled',
        kickedOff: false,
        latestKickedOff: false,
      },
      { launchId: 'launch-paired', kickedOff: false, latestKickedOff: false },
      {
        launchId: 'launch-in-progress',
        kickedOff: true,
        latestKickedOff: true,
      },
      { launchId: 'launch-finished', kickedOff: true, latestKickedOff: false },
    ]);
    expect(view.record.launchCount).toBe(2);
  });

  test('ローンチの無いプロダクトはマッチと対戦相手を照会せず、空の履歴と成績を返す', async () => {
    const { reader, calls } = setup({ launches: [] });

    const view = await pageOf(read(reader));

    expect(view.launches).toEqual([]);
    expect(view.record).toEqual({
      firstLaunchDate: null,
      launchCount: 0,
      wins: 0,
      losses: 0,
    });
    expect(view.awards).toEqual([]);
    expect(calls.listByLaunches).toEqual([]);
    expect(calls.findSummaries).toEqual([]);
  });
});
