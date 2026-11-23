import { describe, expect, test } from 'bun:test';

import type { A11yViolation } from '../../support/a11y-scan.ts';
import {
  describeFinding,
  describeSummary,
  hasFindings,
  parseFindingLines,
  type RouteAuditFinding,
  routeCaseKey,
  routeTestTitle,
  summarizeFindings,
} from './client-route-report.ts';

const VIOLATION: A11yViolation = {
  route: '/p/$handle',
  state: 'with-data',
  rule: 'color-contrast',
  impact: 'serious',
  wcag: ['wcag2aa', 'wcag143'],
  targets: ['main > p.muted', '#footer a'],
};

const finding = (
  overrides: Partial<RouteAuditFinding> = {},
): RouteAuditFinding => ({
  route: '/p/$handle',
  state: 'with-data',
  url: '/p/e2e-product-1',
  status: 200,
  violations: [],
  headerProblems: [],
  ...overrides,
});

describe('routeCaseKey', () => {
  test('経路と状態を区切り文字で繋ぎ、別の組み合わせと衝突しない', () => {
    expect(routeCaseKey('/p/$handle', 'with-data')).toBe(
      '/p/$handle|with-data',
    );
    expect(routeCaseKey('/p/', 'with-data')).not.toBe(
      routeCaseKey('/p', '/with-data'),
    );
  });
});

describe('routeTestTitle', () => {
  test('経路と状態を含む日本語の題名にする', () => {
    expect(routeTestTitle('/p/$handle', 'error')).toBe(
      '/p/$handle(error)は自動のアクセシビリティの検査の違反が0件で、応答にセキュリティヘッダーが付く',
    );
  });
});

describe('hasFindings', () => {
  test('違反もヘッダーの不足も無ければ偽を返す', () => {
    expect(hasFindings(finding())).toBe(false);
  });

  test('違反があれば真を返す', () => {
    expect(hasFindings(finding({ violations: [VIOLATION] }))).toBe(true);
  });

  test('ヘッダーの不足があれば真を返す', () => {
    expect(
      hasFindings(finding({ headerProblems: ['Referrer-Policyがありません'] })),
    ).toBe(true);
  });
});

describe('describeFinding', () => {
  test('経路・状態・開いたURL・状態コードを先頭に示す', () => {
    const [head] = describeFinding(finding()).split('\n');

    expect(head).toBe('/p/$handle(with-data) /p/e2e-product-1 状態コード200');
  });

  test('違反は規則のID・影響度・WCAGの基準・対象の要素を示す', () => {
    const text = describeFinding(finding({ violations: [VIOLATION] }));

    expect(text).toContain('color-contrast');
    expect(text).toContain('serious');
    expect(text).toContain('wcag2aa, wcag143');
    expect(text).toContain('main > p.muted');
    expect(text).toContain('#footer a');
  });

  test('ヘッダーの不足を1行ずつ示す', () => {
    const text = describeFinding(
      finding({
        headerProblems: [
          'Referrer-Policyがありません',
          'Content-Security-Policyがありません',
        ],
      }),
    );

    expect(text).toContain('セキュリティヘッダーの不足');
    expect(text).toContain('Referrer-Policyがありません');
    expect(text).toContain('Content-Security-Policyがありません');
  });

  test('応答を得られなかった場合は状態コードの代わりに応答なしと示す', () => {
    const [head] = describeFinding(finding({ status: null })).split('\n');

    expect(head).toBe('/p/$handle(with-data) /p/e2e-product-1 応答なし');
  });
});

describe('summarizeFindings', () => {
  test('問題のある経路だけを違反の数とヘッダーの不足の数で数える', () => {
    const summary = summarizeFindings([
      finding(),
      finding({ route: '/a', violations: [VIOLATION, VIOLATION] }),
      finding({ route: '/b', headerProblems: ['x'] }),
    ]);

    expect(summary).toEqual({
      checked: 3,
      withFindings: 2,
      violationCount: 2,
      headerProblemCount: 1,
    });
  });

  test('検査した経路が無ければ全て0を返す', () => {
    expect(summarizeFindings([])).toEqual({
      checked: 0,
      withFindings: 0,
      violationCount: 0,
      headerProblemCount: 0,
    });
  });
});

describe('parseFindingLines', () => {
  test('JSON Linesを読み、同じ経路と状態は後に書かれたものを残す', () => {
    const lines = [
      JSON.stringify(finding({ status: 500 })),
      JSON.stringify(finding({ route: '/a', state: 'error' })),
      JSON.stringify(finding({ status: 200 })),
    ].join('\n');

    const parsed = parseFindingLines(`${lines}\n`);

    expect(parsed.map(({ route, status }) => [route, status])).toEqual([
      ['/p/$handle', 200],
      ['/a', 200],
    ]);
  });

  test('空のファイルからは空の一覧を返す', () => {
    expect(parseFindingLines('')).toEqual([]);
  });
});

describe('describeSummary', () => {
  test('検査した数・問題のある数・違反の数・ヘッダーの不足の数を1行で示す', () => {
    expect(
      describeSummary({
        checked: 78,
        withFindings: 2,
        violationCount: 3,
        headerProblemCount: 1,
      }),
    ).toBe(
      '検査した経路と状態 78件、問題のある経路と状態 2件(アクセシビリティの違反 3件、セキュリティヘッダーの不足 1件)',
    );
  });
});
