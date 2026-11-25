import { describe, expect, test } from 'bun:test';

import { inquiryTargetPathOf } from './inquiry-target.ts';
import type { ReportTargetView } from './ports.ts';
import { UNAVAILABLE_TARGET_VIEW } from './report-target-resolver.ts';

const available = (overrides: Partial<ReportTargetView>): ReportTargetView => ({
  ...UNAVAILABLE_TARGET_VIEW,
  available: true,
  ...overrides,
});

describe('inquiryTargetPathOf', () => {
  test('ユーザーはプロフィールのページを示す', () => {
    expect(
      inquiryTargetPathOf('user', available({ handle: 'reported-user' })),
    ).toBe('/@reported-user');
  });

  test('プロダクトはプロダクトのページを示す', () => {
    expect(
      inquiryTargetPathOf('product', available({ handle: 'great-app' })),
    ).toBe('/p/great-app');
  });

  test('コメントは対象のプロダクトのページを示す', () => {
    expect(
      inquiryTargetPathOf(
        'comment',
        available({ handle: 'ignored', productHandle: 'great-app' }),
      ),
    ).toBe('/p/great-app');
  });

  test('ハンドルをURLの1区画として符号化する', () => {
    expect(inquiryTargetPathOf('product', available({ handle: 'a/b?c' }))).toBe(
      '/p/a%2Fb%3Fc',
    );
  });

  test.each([
    ['表示を得られない', 'user' as const, undefined],
    ['表示できない', 'product' as const, UNAVAILABLE_TARGET_VIEW],
    [
      '表示できないと示された',
      'user' as const,
      { ...UNAVAILABLE_TARGET_VIEW, handle: 'reported-user' },
    ],
    ['ハンドルが無いユーザー', 'user' as const, available({})],
    ['ハンドルが無いプロダクト', 'product' as const, available({})],
    [
      'プロダクトのハンドルが無いコメント',
      'comment' as const,
      available({ handle: 'ignored', productName: 'プロダクト' }),
    ],
  ])('%sの対象はURLを示せない', (_label, kind, view) => {
    expect(inquiryTargetPathOf(kind, view)).toBeUndefined();
  });
});
