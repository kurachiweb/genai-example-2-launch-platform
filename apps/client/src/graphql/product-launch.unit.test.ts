import { describe, expect, test } from 'bun:test';

import type {
  LaunchStatus,
  ProductAwardKind,
  QualifierOutcome,
} from './generated/graphql.ts';
import {
  type GraphQLProductLaunch,
  toProductAwardView,
  toProductLaunchView,
} from './product-launch.ts';

const launchOf = (
  status: LaunchStatus,
  outcome: QualifierOutcome | null,
): GraphQLProductLaunch => ({
  id: '01JD0LAUNCH000000000000001',
  number: 2,
  launchDate: '2026-11-12',
  kickoffAt: '2026-11-11T15:00:00.000Z',
  status,
  outcome,
  summary: { label: '予選マッチ勝利', inMatch: false },
});

describe('toProductLaunchView', () => {
  test.each([
    ['SCHEDULED', 'scheduled'],
    ['PAIRED', 'paired'],
    ['IN_PROGRESS', 'in_progress'],
    ['FINISHED', 'finished'],
    ['CANCELED', 'canceled'],
  ] as const)('状態%sを画面の値%sへ写す', (status, expected) => {
    expect(toProductLaunchView(launchOf(status, null)).status).toBe(expected);
  });

  test.each([
    ['WON', 'won'],
    ['LOST', 'lost'],
    [null, null],
  ] as const)('予選の結果%sを%sへ写す', (outcome, expected) => {
    expect(toProductLaunchView(launchOf('FINISHED', outcome)).outcome).toBe(
      expected,
    );
  });

  test('番号・ローンチ日・キックオフの日時・要約はそのまま残す', () => {
    expect(toProductLaunchView(launchOf('FINISHED', 'WON'))).toStrictEqual({
      id: '01JD0LAUNCH000000000000001',
      number: 2,
      launchDate: '2026-11-12',
      kickoffAt: '2026-11-11T15:00:00.000Z',
      status: 'finished',
      outcome: 'won',
      summary: { label: '予選マッチ勝利', inMatch: false },
    });
  });
});

describe('toProductAwardView', () => {
  test.each([
    ['WEEK', 'week'],
    ['YEAR', 'year'],
  ] as const)('賞の種類%sを%sへ写し、回数とラベルを残す', (kind, expected) => {
    const award: {
      kind: ProductAwardKind;
      count: number;
      labels: string[];
    } = { kind, count: 3, labels: ['2026年第44週', '2026年第45週'] };

    expect(toProductAwardView(award)).toStrictEqual({
      kind: expected,
      count: 3,
      labels: ['2026年第44週', '2026年第45週'],
    });
  });
});
