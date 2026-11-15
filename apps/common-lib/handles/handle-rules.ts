export const HANDLE_PATTERN: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export interface HandleRule {
  readonly maxLength: number;
  readonly reservedWords: readonly string[];
}

export type HandleFormatCheck =
  'ok' | 'empty' | 'too-long' | 'invalid-characters';

const ASCII_UPPER_CASE_LETTERS = /[A-Z]/gu;

export const IMPERSONATION_RESERVED_HANDLES: readonly string[] = Object.freeze([
  'admin',
  'administrator',
  'root',
  'superuser',
  'staff',
  'moderator',
  'mod',
  'official',
  'support',
  'security',
  'team',
  'launchstadium',
  'launch-stadium',
  'launch_stadium',
]);

// ハンドルは英数字・ハイフン・アンダースコアのASCIIだけを許すため、文字数はUTF-16の長さで数えてよい
export const checkHandleFormat = (
  value: string,
  rule: Pick<HandleRule, 'maxLength'>,
): HandleFormatCheck => {
  if (value.length === 0) {
    return 'empty';
  }
  if (value.length > rule.maxLength) {
    return 'too-long';
  }
  return HANDLE_PATTERN.test(value) ? 'ok' : 'invalid-characters';
};

// SQLiteのCOLLATE NOCASEはASCIIの英字だけを同一視するため、toLowerCaseではなくA〜Zだけを小文字にして列の一意と同じ結果にする
export const toHandleKey = (value: string): string =>
  value.replace(ASCII_UPPER_CASE_LETTERS, (letter) => letter.toLowerCase());

export const isSameHandle = (a: string, b: string): boolean =>
  toHandleKey(a) === toHandleKey(b);

export const isReservedHandle = (
  value: string,
  rule: Pick<HandleRule, 'reservedWords'>,
): boolean => {
  const key = toHandleKey(value);
  return rule.reservedWords.some((word) => toHandleKey(word) === key);
};
