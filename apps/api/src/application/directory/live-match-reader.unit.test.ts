import { describe, expect, test } from 'bun:test';

import type { ProductHandleResolution } from '../../../lib/core/product/ports.ts';
import { DirectoryLiveMatchReader } from './live-match-reader.ts';
import {
  createFakePorts,
  currentResolution,
  date,
  type FakeOptions,
  launchOf,
  matchOf,
  NOW,
  OPPONENT_ID,
  OWNER_ID,
  PRODUCT_HANDLE,
  PRODUCT_ID,
  STRANGER_ID,
  summaryOf,
  viewerOf,
} from './testing/product-page-fakes.ts';

function setup(options: FakeOptions = {}) {
  const ports = createFakePorts(options);
  const reader = new DirectoryLiveMatchReader(ports.products, ports.matches);
  return { reader, calls: ports.calls };
}

const read = (
  reader: DirectoryLiveMatchReader,
  options: { readonly handle?: string; readonly viewerId?: string } = {},
) =>
  reader.read({
    productHandle: options.handle ?? PRODUCT_HANDLE,
    viewer:
      options.viewerId === undefined ? undefined : viewerOf(options.viewerId),
    now: NOW,
  });

const TODAY = '2026-11-10';

const todayLaunch = launchOf('launch-today', {
  number: 2,
  launchDate: date(TODAY),
  status: 'in_progress',
  outcome: null,
  decidedAt: null,
});

const finishedLaunch = launchOf('launch-finished', { number: 1 });

const ownSide = (launchId: string, entryId = `entry-${launchId}`) => ({
  entryId,
  launchId,
  productId: PRODUCT_ID,
});

const opponentSide = (entryId: string) => ({
  entryId,
  launchId: `launch-of-${entryId}`,
  productId: OPPONENT_ID,
});

const finishedQualifier = matchOf({
  matchId: 'match-finished',
  sides: [
    { ...ownSide('launch-finished'), result: 'won' },
    { ...opponentSide('entry-old-opponent'), result: 'lost' },
  ],
});

describe('LiveMatchReader.read: 表示できないプロダクト', () => {
  const NULL_CASES: readonly [
    string,
    ProductHandleResolution,
    string | undefined,
  ][] = [
    ['存在しない', { kind: 'none' }, undefined],
    [
      '可視でない',
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
      '旧ハンドル',
      { kind: 'previous', product: summaryOf(PRODUCT_ID) },
      undefined,
    ],
  ];

  test.each(NULL_CASES)(
    '%sならnullを返し、ローンチを読まない',
    async (_label, resolution, viewerId) => {
      const { reader, calls } = setup({ resolution });

      expect(await read(reader, { viewerId })).toBeNull();
      expect(calls.listLaunches).toEqual([]);
      expect(calls.listByLaunches).toEqual([]);
    },
  );

  test('ハンドルが形式に合わなければ照会をせずにnullを返す', async () => {
    const { reader, calls } = setup();

    expect(await read(reader, { handle: 'bad handle' })).toBeNull();
    expect(calls.resolveHandle).toEqual([]);
  });

  test('本人の未掲載のプロダクトは開催中のマッチを返す', async () => {
    const { reader } = setup({
      resolution: currentResolution(summaryOf(PRODUCT_ID, { listed: false })),
      launches: [todayLaunch],
      matches: [
        matchOf({
          matchId: 'match-live',
          matchDate: TODAY,
          phase: 'live',
          sides: [ownSide('launch-today'), opponentSide('entry-opponent')],
        }),
      ],
    });

    expect(await read(reader, { viewerId: OWNER_ID })).toEqual({
      serverTime: NOW,
      matchId: 'match-live',
      awaitingChange: false,
    });
  });
});

describe('LiveMatchReader.read: 開催中のマッチ', () => {
  test('ローンチとマッチを処理の時刻で1回ずつ読み、取消のローンチを除く', async () => {
    const { reader, calls } = setup({
      launches: [
        launchOf('launch-canceled', {
          number: 0,
          launchDate: date('2026-11-12'),
          status: 'canceled',
          outcome: null,
          decidedAt: null,
        }),
        todayLaunch,
        finishedLaunch,
      ],
    });

    await read(reader);

    expect(calls.listLaunches).toEqual([{ ids: [PRODUCT_ID], now: NOW }]);
    expect(calls.listByLaunches).toEqual([
      { ids: ['launch-today', 'launch-finished'], now: NOW },
    ]);
  });

  test('マッチ中と集計中のうち最も新しいマッチを返し、照会の時点の時刻を添える', async () => {
    const { reader } = setup({
      launches: [todayLaunch, finishedLaunch],
      matches: [
        finishedQualifier,
        matchOf({
          matchId: 'match-tallying',
          matchDate: '2026-11-09',
          kind: 'week',
          phase: 'tallying',
          sides: [
            ownSide('launch-finished', 'entry-week'),
            opponentSide('entry-w'),
          ],
        }),
        matchOf({
          matchId: 'match-live',
          matchDate: TODAY,
          phase: 'live',
          sides: [ownSide('launch-today'), opponentSide('entry-opponent')],
        }),
      ],
    });

    const view = await read(reader);

    expect(view).toEqual({
      serverTime: NOW,
      matchId: 'match-live',
      awaitingChange: true,
    });
  });

  test('開催中のマッチが無く変化を待つ状態でもなければ、マッチ無しで待たない', async () => {
    const { reader } = setup({
      launches: [finishedLaunch],
      matches: [finishedQualifier],
    });

    expect(await read(reader)).toEqual({
      serverTime: NOW,
      matchId: null,
      awaitingChange: false,
    });
  });

  test('ローンチの無いプロダクトはマッチを読まずにマッチ無しを返す', async () => {
    const { reader, calls } = setup({ launches: [] });

    expect(await read(reader)).toEqual({
      serverTime: NOW,
      matchId: null,
      awaitingChange: false,
    });
    expect(calls.listByLaunches).toEqual([]);
  });
});

describe('LiveMatchReader.read: 変化を待つ状態', () => {
  test('集計中のマッチがあれば待つ', async () => {
    const { reader } = setup({
      launches: [todayLaunch],
      matches: [
        matchOf({
          matchId: 'match-tallying',
          matchDate: TODAY,
          phase: 'tallying',
          sides: [ownSide('launch-today'), opponentSide('entry-opponent')],
        }),
      ],
    });

    expect(await read(reader)).toEqual({
      serverTime: NOW,
      matchId: 'match-tallying',
      awaitingChange: true,
    });
  });

  test('キックオフ済みのローンチの予選マッチが未作成なら待つ', async () => {
    const { reader } = setup({
      launches: [todayLaunch, finishedLaunch],
      matches: [finishedQualifier],
    });

    expect((await read(reader))?.awaitingChange).toBe(true);
  });

  test('キックオフ前のローンチの予選マッチが未作成でも待たない', async () => {
    const { reader } = setup({
      launches: [
        launchOf('launch-paired', {
          number: 2,
          launchDate: date('2026-11-11'),
          status: 'paired',
          outcome: null,
          decidedAt: null,
        }),
        finishedLaunch,
      ],
      matches: [finishedQualifier],
    });

    expect((await read(reader))?.awaitingChange).toBe(false);
  });

  test('開始の時刻を過ぎて開始していないマッチがあれば待つ', async () => {
    const { reader } = setup({
      launches: [todayLaunch],
      matches: [
        matchOf({
          matchId: 'match-pending',
          matchDate: TODAY,
          phase: 'scheduled',
          startedAt: null,
          startsAt: new Date(NOW.getTime() - 1000),
          sides: [ownSide('launch-today'), opponentSide('entry-opponent')],
        }),
      ],
    });

    expect(await read(reader)).toEqual({
      serverTime: NOW,
      matchId: null,
      awaitingChange: true,
    });
  });

  test('開始の時刻がちょうど今の未開始のマッチも待つ', async () => {
    const { reader } = setup({
      launches: [todayLaunch],
      matches: [
        matchOf({
          matchId: 'match-pending',
          matchDate: TODAY,
          phase: 'scheduled',
          startedAt: null,
          startsAt: NOW,
          sides: [ownSide('launch-today'), opponentSide('entry-opponent')],
        }),
      ],
    });

    expect((await read(reader))?.awaitingChange).toBe(true);
  });

  test('開始の時刻の前の予定のマッチだけなら待たない', async () => {
    const { reader } = setup({
      launches: [todayLaunch],
      matches: [
        matchOf({
          matchId: 'match-later',
          matchDate: TODAY,
          kind: 'week',
          phase: 'scheduled',
          startedAt: null,
          startsAt: new Date(NOW.getTime() + 1000),
          sides: [ownSide('launch-today'), opponentSide('entry-opponent')],
        }),
        matchOf({
          matchId: 'match-today-qualifier',
          matchDate: TODAY,
          sides: [
            { ...ownSide('launch-today', 'entry-q'), result: 'won' },
            { ...opponentSide('entry-q-opponent'), result: 'lost' },
          ],
        }),
      ],
    });

    expect(await read(reader)).toEqual({
      serverTime: NOW,
      matchId: null,
      awaitingChange: false,
    });
  });
});
