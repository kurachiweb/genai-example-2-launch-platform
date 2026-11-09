import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { LaunchPlan } from './launch-plan.ts';
import { planProductEdit } from './product-edit-plan.ts';

const day = (value: string): BusinessDate => parseBusinessDate(value);

const CURRENT = {
  handle: 'my-app',
  logoFileId: 'logo-1',
  screenshotFileIds: ['shot-1', 'shot-2', 'shot-3'],
  categoryId: 'cat-1',
};

const UNCHANGED_INPUT = { ...CURRENT, launchDate: null };

const NEW_PLAN: LaunchPlan = { mode: 'new', basis: null };

const RESCHEDULE_PLAN: LaunchPlan = {
  mode: 'reschedule',
  launchId: 'launch-1',
  current: day('2026-09-20'),
  basis: null,
};

const BLOCKED_PLAN: LaunchPlan = {
  mode: 'blocked',
  blocks: [
    {
      code: 'launch_scheduled',
      message: 'このプロダクトはローンチ予定があるため再ローンチできません。',
      releaseAt: null,
    },
  ],
};

const UNKNOWN_PLAN: LaunchPlan = { mode: 'unknown' };

const edit = (
  input: Partial<typeof UNCHANGED_INPUT> | { launchDate: BusinessDate | null },
  plan: LaunchPlan = NEW_PLAN,
) => planProductEdit(CURRENT, { ...UNCHANGED_INPUT, ...input }, plan);

const successOf = (result: ReturnType<typeof planProductEdit>) => {
  if ('error' in result) {
    throw new Error(`計画が拒否されました: ${result.error}`);
  }
  return result;
};

describe('planProductEdit の変更なし', () => {
  test('何も変えなければ全ての項目が変更なしになる', () => {
    expect(edit({})).toEqual({
      handle: { kind: 'none' },
      logo: { kind: 'keep' },
      screenshots: {
        added: [],
        removed: [],
        order: ['shot-1', 'shot-2', 'shot-3'],
      },
      categoryChanged: false,
      launch: { kind: 'none' },
    });
  });
});

describe('planProductEdit のハンドル', () => {
  test('大文字小文字だけの変更はcase-onlyになり旧ハンドルを持たない', () => {
    expect(successOf(edit({ handle: 'My-App' })).handle).toEqual({
      kind: 'case-only',
      next: 'My-App',
    });
  });

  test('別の文字列への変更はchangedになり変更前のハンドルを持つ', () => {
    expect(successOf(edit({ handle: 'my-app-2' })).handle).toEqual({
      kind: 'changed',
      next: 'my-app-2',
      previous: 'my-app',
    });
  });
});

describe('planProductEdit のロゴ', () => {
  test('別の画像への差し替えは新しいIDと差し替えられたIDを持つ', () => {
    expect(successOf(edit({ logoFileId: 'logo-2' })).logo).toEqual({
      kind: 'replace',
      fileId: 'logo-2',
      replaced: 'logo-1',
    });
  });
});

describe('planProductEdit のスクリーンショット', () => {
  test('追加した画像をaddedに、入力の順をorderに持つ', () => {
    expect(
      successOf(
        edit({ screenshotFileIds: ['shot-4', 'shot-1', 'shot-2', 'shot-3'] }),
      ).screenshots,
    ).toEqual({
      added: ['shot-4'],
      removed: [],
      order: ['shot-4', 'shot-1', 'shot-2', 'shot-3'],
    });
  });

  test('取り除いた画像をremovedに持つ', () => {
    expect(
      successOf(edit({ screenshotFileIds: ['shot-3'] })).screenshots,
    ).toEqual({
      added: [],
      removed: ['shot-1', 'shot-2'],
      order: ['shot-3'],
    });
  });

  test('並べ替えだけなら追加も削除も無く、入力の順を持つ', () => {
    expect(
      successOf(edit({ screenshotFileIds: ['shot-3', 'shot-1', 'shot-2'] }))
        .screenshots,
    ).toEqual({
      added: [],
      removed: [],
      order: ['shot-3', 'shot-1', 'shot-2'],
    });
  });

  test('追加と削除を同時に持ち、全て取り除けばorderは空になる', () => {
    expect(
      successOf(edit({ screenshotFileIds: ['shot-2', 'shot-5'] })).screenshots,
    ).toEqual({
      added: ['shot-5'],
      removed: ['shot-1', 'shot-3'],
      order: ['shot-2', 'shot-5'],
    });
    expect(successOf(edit({ screenshotFileIds: [] })).screenshots).toEqual({
      added: [],
      removed: ['shot-1', 'shot-2', 'shot-3'],
      order: [],
    });
  });
});

describe('planProductEdit のカテゴリ', () => {
  test('別のカテゴリを選べば変更ありになる', () => {
    expect(successOf(edit({ categoryId: 'cat-2' })).categoryChanged).toBe(true);
  });
});

describe('planProductEdit のローンチ', () => {
  test('次回の予約ができる計画で日付があれば予約する', () => {
    expect(
      successOf(edit({ launchDate: day('2026-09-25') }, NEW_PLAN)).launch,
    ).toEqual({ kind: 'reserve', date: day('2026-09-25') });
  });

  test('変更の計画で違う日付なら変更する', () => {
    expect(
      successOf(edit({ launchDate: day('2026-09-25') }, RESCHEDULE_PLAN))
        .launch,
    ).toEqual({
      kind: 'reschedule',
      launchId: 'launch-1',
      date: day('2026-09-25'),
    });
  });

  test('変更の計画で同じ日付なら変更なしになる', () => {
    expect(
      successOf(edit({ launchDate: day('2026-09-20') }, RESCHEDULE_PLAN))
        .launch,
    ).toEqual({ kind: 'none' });
  });

  test.each([
    ['次回の予約ができる計画', NEW_PLAN],
    ['変更の計画', RESCHEDULE_PLAN],
    ['禁止の計画', BLOCKED_PLAN],
    ['確認できない計画', UNKNOWN_PLAN],
  ])('%sで日付が無ければローンチを変えない', (_, plan) => {
    expect(successOf(edit({ launchDate: null }, plan)).launch).toEqual({
      kind: 'none',
    });
  });

  test.each([
    ['禁止の計画', BLOCKED_PLAN],
    ['確認できない計画', UNKNOWN_PLAN],
  ])('%sで日付があれば拒否する', (_, plan) => {
    expect(edit({ launchDate: day('2026-09-25') }, plan)).toEqual({
      error: 'launch-not-allowed',
    });
  });
});
