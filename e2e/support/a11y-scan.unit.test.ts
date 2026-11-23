import { describe, expect, test } from 'bun:test';

import type { Page } from '@playwright/test';
import type axe from 'axe-core';

import { WCAG_22_AA_TAGS } from '../../apps/frontend-lib/test/a11y.ts';
import { scanPage, toA11yViolations, WCAG22_AA_TAGS } from './a11y-scan.ts';

const CONTEXT = { route: '/p/$handle', state: 'with-data' } as const;

const violation = (overrides: Partial<axe.Result>): axe.Result => ({
  id: 'color-contrast',
  impact: 'serious',
  tags: ['cat.color', 'wcag2aa', 'wcag143'],
  description: '',
  help: '',
  helpUrl: '',
  nodes: [],
  ...overrides,
});

const node = (target: axe.UnlabelledFrameSelector): axe.NodeResult => ({
  html: '<div></div>',
  target,
  any: [],
  all: [],
  none: [],
});

interface FakePage {
  readonly page: Page;
  readonly evaluated: unknown[];
}

const fakePage = (results: axe.AxeResults | Error): FakePage => {
  const evaluated: unknown[] = [];
  const page = {
    evaluate: (script: unknown, argument?: unknown) => {
      evaluated.push({ script, argument });
      if (typeof script === 'string') {
        return Promise.resolve();
      }
      if (results instanceof Error) {
        return Promise.reject(results);
      }
      return Promise.resolve(results);
    },
  } as unknown as Page;
  return { page, evaluated };
};

const emptyResults = (violations: axe.Result[]): axe.AxeResults =>
  ({ violations }) as unknown as axe.AxeResults;

describe('WCAG22_AA_TAGS', () => {
  test('画面の共通部品のrunAxeと同じWCAGのタグである', () => {
    expect(WCAG22_AA_TAGS).toEqual(WCAG_22_AA_TAGS);
  });

  test('WCAG 2.2のAとAAを含む', () => {
    expect(WCAG22_AA_TAGS).toEqual([
      'wcag2a',
      'wcag2aa',
      'wcag21a',
      'wcag21aa',
      'wcag22aa',
    ]);
  });
});

describe('toA11yViolations', () => {
  test('違反が無ければ空の配列を返す', () => {
    expect(toA11yViolations([], CONTEXT)).toEqual([]);
  });

  test('規則・影響度・WCAGの基準・対象を経路と状態とともに返す', () => {
    const result = toA11yViolations(
      [
        violation({
          nodes: [node(['#a']), node(['.b > .c'])],
        }),
      ],
      CONTEXT,
    );

    expect(result).toEqual([
      {
        route: '/p/$handle',
        state: 'with-data',
        rule: 'color-contrast',
        impact: 'serious',
        wcag: ['wcag2aa', 'wcag143'],
        targets: ['#a', '.b > .c'],
      },
    ]);
  });

  test('WCAGでないタグを基準から除く', () => {
    const [first] = toA11yViolations(
      [violation({ tags: ['cat.aria', 'best-practice', 'wcag412'] })],
      CONTEXT,
    );

    expect(first?.wcag).toEqual(['wcag412']);
  });

  test('影響度が無い違反はnullにする', () => {
    const [first] = toA11yViolations(
      [violation({ impact: undefined })],
      CONTEXT,
    );

    expect(first?.impact).toBeNull();
  });

  test('iframeやシャドウツリーの対象は入れ子の選択子を空白でつなぐ', () => {
    const [first] = toA11yViolations(
      [violation({ nodes: [node([['iframe#x', '#inner']])] })],
      CONTEXT,
    );

    expect(first?.targets).toEqual(['iframe#x #inner']);
  });
});

describe('scanPage', () => {
  test('axeの本体をページへ注入してから検査し、違反を経路と状態とともに返す', async () => {
    const { page, evaluated } = fakePage(
      emptyResults([violation({ nodes: [node(['#a'])] })]),
    );

    const result = await scanPage(page, CONTEXT);

    expect(typeof (evaluated[0] as { script: unknown }).script).toBe('string');
    expect((evaluated[0] as { script: string }).script).toContain('axe');
    expect((evaluated[1] as { argument: unknown }).argument).toEqual({
      runOnly: { type: 'tag', values: [...WCAG22_AA_TAGS] },
    });
    expect(result).toEqual([
      {
        route: '/p/$handle',
        state: 'with-data',
        rule: 'color-contrast',
        impact: 'serious',
        wcag: ['wcag2aa', 'wcag143'],
        targets: ['#a'],
      },
    ]);
  });

  test('違反が無いページは空の配列を返す', async () => {
    const { page } = fakePage(emptyResults([]));

    expect(await scanPage(page, CONTEXT)).toEqual([]);
  });

  test('検査の実行が失敗したら握りつぶさず経路と状態を添えて例外にする', async () => {
    const { page } = fakePage(new Error('boom'));

    const failure = await scanPage(page, CONTEXT).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('/p/$handle(with-data)');
    expect((failure as Error).cause).toBeInstanceOf(Error);
  });
});
