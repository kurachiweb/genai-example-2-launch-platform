import { describe, expect, test } from 'bun:test';

import {
  formatRecoveryCode,
  normalizeRecoveryCodeInput,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
} from './recovery-code-format.ts';

const RAW_CODE = 'abcdefghjkmnpqrs';

const FORMATTED_CODE = 'abcd-efgh-jkmn-pqrs';

describe('リカバリコードの定数', () => {
  test('1回に10個、16文字で発行する', () => {
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(RECOVERY_CODE_LENGTH).toBe(16);
  });

  test('文字は紛らわしいi・l・o・0・1を除いた英小文字と数字の重複しない31文字', () => {
    expect(RECOVERY_CODE_ALPHABET).toBe('abcdefghjkmnpqrstuvwxyz23456789');
    expect(new Set(RECOVERY_CODE_ALPHABET).size).toBe(31);
    for (const confusable of ['i', 'l', 'o', '0', '1']) {
      expect(RECOVERY_CODE_ALPHABET).not.toContain(confusable);
    }
  });
});

describe('formatRecoveryCode', () => {
  test('4文字ずつハイフンで区切って表示の形にする', () => {
    expect(formatRecoveryCode(RAW_CODE)).toBe(FORMATTED_CODE);
  });

  test.each([
    { case: '15文字', raw: RAW_CODE.slice(1) },
    { case: '17文字', raw: `${RAW_CODE}a` },
    { case: '使わない文字を含む', raw: `${RAW_CODE.slice(1)}0` },
    { case: '大文字を含む', raw: RAW_CODE.toUpperCase() },
  ])('発行の形でない値($case)は誤りとして投げる', ({ raw }) => {
    expect(() => formatRecoveryCode(raw)).toThrow(RangeError);
  });
});

describe('normalizeRecoveryCodeInput', () => {
  test.each([
    { case: '表示の形', input: FORMATTED_CODE },
    { case: '区切りの無い形', input: RAW_CODE },
    { case: '大文字', input: 'ABCD-EFGH-JKMN-PQRS' },
    { case: '空白で区切った形', input: ' abcd efgh\tjkmn　pqrs\n' },
    {
      case: '全角の英字とハイフン',
      input: 'ＡＢＣＤ－ＥＦＧＨ－ＪＫＭＮ－ＰＱＲＳ',
    },
    { case: 'ハイフン以外のダッシュの区切り', input: 'abcd‐efgh–jkmn—pqrs' },
  ])('$caseを発行の形に揃える', ({ input }) => {
    expect(normalizeRecoveryCodeInput(input)).toBe(RAW_CODE);
  });

  test('表示の形から戻した値は表示の形へ同じに整形できる', () => {
    const normalized = normalizeRecoveryCodeInput(FORMATTED_CODE);
    expect(normalized).toBeDefined();
    expect(formatRecoveryCode(normalized ?? '')).toBe(FORMATTED_CODE);
  });

  test.each([
    { case: '空', input: '' },
    { case: '空白だけ', input: ' - ' },
    { case: '15文字', input: 'abcd-efgh-jkmn-pqr' },
    { case: '17文字', input: 'abcd-efgh-jkmn-pqrst' },
    { case: '使わない文字i', input: 'abcd-efgh-ijkm-npqr' },
    { case: '使わない数字0', input: 'abcd-efgh-jkmn-pqr0' },
    { case: '認証コードの数字6桁', input: '123456' },
    { case: '記号', input: 'abcd_efgh_jkmn_pqrs' },
    { case: '極端に長い入力', input: `${FORMATTED_CODE}${' '.repeat(1000)}` },
  ])('形式に合わない入力($case)はundefinedを返す', ({ input }) => {
    expect(normalizeRecoveryCodeInput(input)).toBeUndefined();
  });
});
