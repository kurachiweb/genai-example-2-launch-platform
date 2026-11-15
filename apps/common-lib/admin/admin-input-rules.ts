import { countGraphemes } from '../text/graphemes.ts';
import { hasForbiddenCharacters } from '../text/text-safety.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const ADMIN_NICKNAME_MAX = 25;

export const ADMIN_TITLE_MAX = 50;

export const AUDIT_REASON_MAX = 500;

export const CATEGORY_NAME_MAX = 30;

// 監査ログの検索の文字列の条件は保存された値との一致だけに使うため、保存され得る長さを上限にする
export const AUDIT_FILTER_TEXT_MAX = 64;

export const AUDIT_LOG_CURSOR_MAX = 256;

const countTrimmedGraphemes = (value: string): number =>
  countGraphemes(trimWhiteSpace(value));

const checkRequired = (
  value: string,
  max: number,
): 'empty' | 'too-long' | undefined => {
  const graphemes = countTrimmedGraphemes(value);
  if (graphemes === 0) {
    return 'empty';
  }
  return graphemes > max ? 'too-long' : undefined;
};

const checkOptional = (value: string, max: number): 'too-long' | undefined =>
  countTrimmedGraphemes(value) > max ? 'too-long' : undefined;

export const checkAdminNickname = (
  value: string,
): 'empty' | 'too-long' | undefined => checkRequired(value, ADMIN_NICKNAME_MAX);

export const checkAdminTitle = (value: string): 'too-long' | undefined =>
  checkOptional(value, ADMIN_TITLE_MAX);

export const checkAuditReason = (value: string): 'too-long' | undefined =>
  checkOptional(value, AUDIT_REASON_MAX);

export type CategoryNameIssue = 'forbidden-character' | 'empty' | 'too-long';

// カテゴリ名は利用者側の画面にも表示されるため、使用できない文字を拒む。VT・FF・NELは空白でもあるため、前後の空白を除く前に調べて、端にあっても黙って除かずに拒む
export const checkCategoryName = (
  value: string,
): CategoryNameIssue | undefined =>
  hasForbiddenCharacters(value)
    ? 'forbidden-character'
    : checkRequired(value, CATEGORY_NAME_MAX);

export const CATEGORY_NAME_MESSAGES: Readonly<
  Record<CategoryNameIssue, string>
> = Object.freeze({
  'forbidden-character': 'カテゴリ名に使用できない文字が含まれています。',
  empty: 'カテゴリ名を入力してください。',
  'too-long': `カテゴリ名は${String(CATEGORY_NAME_MAX)}文字以内で入力してください。`,
});
