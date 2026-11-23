import { describe, expect, test } from 'bun:test';

import type { LayoutIssue } from './responsive-measure.ts';
import {
  describeResponsiveFinding,
  describeResponsiveSummary,
  hasResponsiveViolations,
  issueSignature,
  parseResponsiveFindingLines,
  type ResponsiveFinding,
  summarizeResponsiveFindings,
  toViolations,
} from './responsive-report.ts';

const OVERLAP: LayoutIssue = {
  kind: 'overlap',
  detail: '重なり 40x12px',
  targets: ['h2 "見出し"', 'p "本文"'],
};

const OVERFLOW: LayoutIssue = {
  kind: 'element-overflow',
  detail: '右端が画面の外 340px(画面の幅320px)',
  targets: ['table.wide'],
};

const context = {
  route: '/p/$handle',
  state: 'with-data',
  width: 320,
} as const;

const finding = (
  overrides: Partial<ResponsiveFinding> = {},
): ResponsiveFinding => ({
  route: '/p/$handle',
  state: 'with-data',
  url: '/p/e2e-product-1',
  status: 200,
  violations: [],
  ...overrides,
});

describe('issueSignature', () => {
  test('種別と対象が同じなら、詳細の数値が違っても同じ署名にする', () => {
    expect(issueSignature(OVERLAP)).toBe(
      issueSignature({ ...OVERLAP, detail: '重なり 80x20px' }),
    );
  });

  test('対象が違えば別の署名にする', () => {
    expect(issueSignature(OVERLAP)).not.toBe(
      issueSignature({ ...OVERLAP, targets: ['h2 "見出し"', 'p "別"'] }),
    );
  });
});

describe('toViolations', () => {
  test('経路・状態・幅・条件を各問題へ付ける', () => {
    expect(toViolations(context, 'text-expansion', [OVERLAP], [])).toEqual([
      {
        ...OVERLAP,
        route: '/p/$handle',
        state: 'with-data',
        width: 320,
        condition: 'text-expansion',
        alsoInPlain: false,
      },
    ]);
  });

  test('文字列を伸ばす前から同じ問題があれば、その旨を付ける', () => {
    const [violation] = toViolations(
      context,
      'font-scale',
      [OVERLAP, OVERFLOW],
      [OVERLAP],
    );
    const [, second] = toViolations(
      context,
      'font-scale',
      [OVERLAP, OVERFLOW],
      [OVERLAP],
    );

    expect(violation?.alsoInPlain).toBe(true);
    expect(second?.alsoInPlain).toBe(false);
  });

  test('問題が無ければ空を返す', () => {
    expect(toViolations(context, 'plain', [], [])).toEqual([]);
  });
});

describe('hasResponsiveViolations', () => {
  test('違反が無ければ偽、あれば真を返す', () => {
    expect(hasResponsiveViolations(finding())).toBe(false);
    expect(
      hasResponsiveViolations(
        finding({ violations: toViolations(context, 'plain', [OVERLAP], []) }),
      ),
    ).toBe(true);
  });
});

describe('describeResponsiveFinding', () => {
  test('経路・状態・幅・条件・対象を含める', () => {
    const text = describeResponsiveFinding(
      finding({
        violations: toViolations(context, 'text-spacing', [OVERLAP], []),
      }),
    );

    expect(text).toContain('/p/$handle(with-data)');
    expect(text).toContain('320px');
    expect(text).toContain('text-spacing');
    expect(text).toContain('h2 "見出し"');
    expect(text).toContain('p "本文"');
  });

  test('応答が無い時は応答なしと示す', () => {
    expect(describeResponsiveFinding(finding({ status: null }))).toContain(
      '応答なし',
    );
  });
});

describe('summarizeResponsiveFindings', () => {
  test('検査した件数と、種別・条件ごとの違反の件数を数える', () => {
    const findings = [
      finding(),
      finding({
        state: 'error',
        violations: [
          ...toViolations(context, 'plain', [OVERFLOW], []),
          ...toViolations(context, 'text-expansion', [OVERLAP], []),
        ],
      }),
    ];

    expect(summarizeResponsiveFindings(findings)).toEqual({
      checked: 2,
      withViolations: 1,
      violationCount: 2,
      byKind: { overlap: 1, 'element-overflow': 1, 'horizontal-scroll': 0 },
      byCondition: {
        plain: 1,
        'text-spacing': 0,
        'text-expansion': 1,
        'font-scale': 0,
      },
    });
  });

  test('要約を日本語の1行にする', () => {
    const text = describeResponsiveSummary(
      summarizeResponsiveFindings([finding()]),
    );

    expect(text).toContain('検査した経路と状態 1件');
    expect(text).toContain('違反のある経路と状態 0件');
  });
});

describe('parseResponsiveFindingLines', () => {
  test('同じ経路と状態が重ねて書かれても最後の結果だけを返す', () => {
    const first = finding({ status: 500 });
    const second = finding({ status: 200 });
    const text = [first, second].map((item) => JSON.stringify(item)).join('\n');

    expect(parseResponsiveFindingLines(`${text}\n\n`)).toEqual([second]);
  });
});
