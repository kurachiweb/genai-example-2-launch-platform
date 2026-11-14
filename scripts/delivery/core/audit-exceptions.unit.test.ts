import { describe, expect, test } from 'bun:test';

import {
  AUDIT_EXCEPTIONS,
  type AuditException,
  auditArgs,
  auditExceptionProblems,
} from './audit-exceptions.ts';

const EXCEPTION: AuditException = {
  advisory: 'GHSA-mrhx-c7xc-m3w5',
  reason: '到達しない経路でしか使われないため',
  reviewBy: '2026-11-30',
};

describe('AUDIT_EXCEPTIONS', () => {
  test('初版は空で、問題を持たない', () => {
    expect(AUDIT_EXCEPTIONS).toEqual([]);
    expect(auditExceptionProblems(AUDIT_EXCEPTIONS, '2026-10-29')).toEqual([]);
  });
});

describe('auditArgs', () => {
  test('重大度が最大(critical)の脆弱性だけを失敗にし、除外の識別子ごとに--ignoreを付ける', () => {
    expect(auditArgs([])).toEqual(['audit', '--audit-level=critical']);
    expect(
      auditArgs([EXCEPTION, { ...EXCEPTION, advisory: '1112233' }]),
    ).toEqual([
      'audit',
      '--audit-level=critical',
      '--ignore=GHSA-mrhx-c7xc-m3w5',
      '--ignore=1112233',
    ]);
  });
});

describe('auditExceptionProblems', () => {
  test('見直し期限の当日までの除外は問題にしない', () => {
    expect(auditExceptionProblems([EXCEPTION], '2026-11-30')).toEqual([]);
  });

  test('見直し期限を過ぎた除外を、識別子と期限を添えて問題にする', () => {
    expect(auditExceptionProblems([EXCEPTION], '2026-12-01')).toEqual([
      'GHSA-mrhx-c7xc-m3w5: 見直し期限(2026-11-30)を過ぎています。',
    ]);
  });

  test.each([
    [
      { advisory: 'CVE-2026-0001' },
      'CVE-2026-0001: 識別子はGHSAの形式か数字にしてください。',
    ],
    [
      { advisory: '--audit-level=low' },
      '--audit-level=low: 識別子はGHSAの形式か数字にしてください。',
    ],
    [{ reason: ' ' }, 'GHSA-mrhx-c7xc-m3w5: 除外の理由を書いてください。'],
    [
      { reviewBy: '2026-13-01' },
      'GHSA-mrhx-c7xc-m3w5: 見直し期限(2026-13-01)はYYYY-MM-DDの実在する日付にしてください。',
    ],
    [
      { reviewBy: '2026-02-30' },
      'GHSA-mrhx-c7xc-m3w5: 見直し期限(2026-02-30)はYYYY-MM-DDの実在する日付にしてください。',
    ],
    [
      { reviewBy: '2026/11/30' },
      'GHSA-mrhx-c7xc-m3w5: 見直し期限(2026/11/30)はYYYY-MM-DDの実在する日付にしてください。',
    ],
  ])('不正な除外%pを問題にする', (override, expected) => {
    expect(
      auditExceptionProblems([{ ...EXCEPTION, ...override }], '2026-10-29'),
    ).toEqual([expected]);
  });

  test('同じ識別子の除外が重なれば問題にする', () => {
    expect(
      auditExceptionProblems([EXCEPTION, EXCEPTION], '2026-10-29'),
    ).toEqual(['GHSA-mrhx-c7xc-m3w5: 除外が重複しています。']);
  });
});
