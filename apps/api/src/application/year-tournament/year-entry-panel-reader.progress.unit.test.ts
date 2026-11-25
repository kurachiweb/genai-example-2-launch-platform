import { describe, expect, test } from 'bun:test';

import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  DRAWING_YEAR_ROW,
  entryIdOf,
  entryOf,
  launchIdOf,
  STORED_SCHEDULE,
  yearRowOf,
} from './testing/year-decision-fakes.ts';
import {
  createPanelFakes,
  HANDLE,
  NOW,
  VIEWER,
} from './testing/year-entry-panel-fakes.ts';
import {
  standingOf,
  YEAR_BRACKET_ID,
  yearMatchOf,
} from './testing/year-summary-fakes.ts';

describe('DirectoryYearEntryPanelReader 返金の対象', () => {
  const PURCHASE_ID = '01JF0YPRCH0000000000000001';

  test.each([
    ['pending', true],
    ['requested', true],
    ['none', false],
    ['not_needed', false],
    ['already_refunded', false],
    ['rejected', false],
  ] as const)(
    '購入のある枠の返金の状態が%sなら返金の対象は%p',
    async (refundStatus, refundable) => {
      const { reader } = createPanelFakes({
        entries: [
          entryOf(1, 'forfeited', {
            closeReason: 'deleted',
            classifiedYear: null,
            entitlementSource: 'payment',
            purchaseId: PURCHASE_ID,
            refundStatus,
          }),
        ],
      });

      expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.refundable).toBe(
        refundable,
      );
    },
  );

  test('購入の無い枠は返金待ちでも返金の対象としない', async () => {
    const { reader } = createPanelFakes({
      entries: [
        entryOf(1, 'excluded', {
          closeReason: 'over_capacity',
          purchaseId: null,
          refundStatus: 'pending',
        }),
      ],
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.refundable).toBe(
      false,
    );
  });
});

describe('DirectoryYearEntryPanelReader 進行', () => {
  const FIRST_ROUND_DATE = parseBusinessDate('2027-06-08');
  const IN_PROGRESS = yearRowOf({
    status: 'in_progress',
    drawStartedAt: STORED_SCHEDULE.drawAt,
    bracketId: YEAR_BRACKET_ID,
    firstRoundDate: FIRST_ROUND_DATE,
    participantCount: 64,
  });
  const DURING_FIRST_ROUND = new Date('2027-06-09T03:00:00.000Z');
  const AFTER_FIRST_ROUND = new Date('2027-06-09T12:00:00.000Z');
  const DRAWN_ENTRY = entryOf(1, 'drawn', { entitlementSource: 'payment' });
  const ACTIVE_STANDINGS = new Map([
    [entryIdOf(1), standingOf(64, { participantNo: 3 })],
  ]);

  test('勝ち残りの枠は勝ち残りの進行を返す', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [IN_PROGRESS],
      standings: ACTIVE_STANDINGS,
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, DURING_FIRST_ROUND);

    expect(panel?.progress).toEqual({
      alive: true,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: false,
    });
    expect(reads.standingReads).toEqual([
      { kind: 'year', refs: [entryIdOf(1)] },
    ]);
    expect(reads.matchReads).toEqual([
      { launchIds: [launchIdOf(1)], now: DURING_FIRST_ROUND },
    ]);
  });

  test('ブラケットに敗退が記録された枠は敗退のラウンドとラウンド名を返し、マッチを読まない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [IN_PROGRESS],
      standings: new Map([
        [entryIdOf(1), standingOf(64, { eliminatedRound: 5 })],
      ]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.progress).toEqual({
      alive: false,
      eliminatedRound: 5,
      eliminatedRoundName: '準決勝',
      champion: false,
    });
    expect(reads.matchReads).toEqual([]);
  });

  test('ブラケットへの記録の前でも、直近のYearのマッチで負けが確定していれば敗退とする', async () => {
    const { reader } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [IN_PROGRESS],
      standings: ACTIVE_STANDINGS,
      matches: new Map([
        [
          launchIdOf(1),
          [
            yearMatchOf({
              index: 1,
              launch: 1,
              round: 1,
              date: FIRST_ROUND_DATE,
              now: AFTER_FIRST_ROUND,
              result: 'lost',
            }),
          ],
        ],
      ]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, AFTER_FIRST_ROUND);

    expect(panel?.progress).toEqual({
      alive: false,
      eliminatedRound: 1,
      eliminatedRoundName: '1回戦',
      champion: false,
    });
  });

  test('直近のYearのマッチで勝ちが確定していれば勝ち残りとする', async () => {
    const { reader } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [IN_PROGRESS],
      standings: ACTIVE_STANDINGS,
      matches: new Map([
        [
          launchIdOf(1),
          [
            yearMatchOf({
              index: 1,
              launch: 1,
              round: 1,
              date: FIRST_ROUND_DATE,
              now: AFTER_FIRST_ROUND,
              result: 'won',
            }),
          ],
        ],
      ]),
    });

    expect(
      (await reader.readForOwner(VIEWER, HANDLE, AFTER_FIRST_ROUND))?.progress,
    ).toMatchObject({ alive: true, eliminatedRound: null });
  });

  test('Year以外のマッチの負けでは敗退とせず、直近のYearのマッチで判定する', async () => {
    const { reader } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [IN_PROGRESS],
      standings: ACTIVE_STANDINGS,
      matches: new Map([
        [
          launchIdOf(1),
          [
            yearMatchOf({
              index: 2,
              launch: 1,
              round: 1,
              date: FIRST_ROUND_DATE,
              now: AFTER_FIRST_ROUND,
              result: 'lost',
              kind: 'week',
            }),
            yearMatchOf({
              index: 1,
              launch: 1,
              round: 1,
              date: parseBusinessDate('2027-06-07'),
              now: AFTER_FIRST_ROUND,
              result: 'won',
            }),
          ],
        ],
      ]),
    });

    expect(
      (await reader.readForOwner(VIEWER, HANDLE, AFTER_FIRST_ROUND))?.progress,
    ).toMatchObject({ alive: true, eliminatedRound: null });
  });

  test('年の行に受賞が記録された優勝の枠は優勝の進行を返し、参加者の状態を読まない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [
        yearRowOf({
          ...IN_PROGRESS,
          status: 'finished',
          outcome: 'awarded',
          championEntryId: entryIdOf(1),
          awardedAt: new Date('2027-06-14T06:45:00.000Z'),
        }),
      ],
      standings: new Map([
        [entryIdOf(1), standingOf(64, { status: 'finished', champion: true })],
      ]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.progress).toEqual({
      alive: false,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: true,
    });
    expect(reads.standingReads).toEqual([]);
  });

  test('決勝で勝っても年の受賞の記録の前は優勝とせず、勝ち残りにもしない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [IN_PROGRESS],
      standings: new Map([
        [entryIdOf(1), standingOf(64, { status: 'finished', champion: true })],
      ]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.progress).toEqual({
      alive: false,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: false,
    });
    expect(reads.matchReads).toEqual([]);
  });

  test('組み合わせを書き終える前の組み合わせ決定中の年は勝ち残りとする', async () => {
    const { reader } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [DRAWING_YEAR_ROW],
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.progress).toEqual({
      alive: true,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: false,
    });
  });

  test('参加者の無い進行中の年の枠は勝ち残りとしない', async () => {
    const { reader } = createPanelFakes({
      entries: [DRAWN_ENTRY],
      years: [IN_PROGRESS],
    });

    expect(
      (await reader.readForOwner(VIEWER, HANDLE, NOW))?.progress,
    ).toMatchObject({ alive: false, champion: false });
  });
});
