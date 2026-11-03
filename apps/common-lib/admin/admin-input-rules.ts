import { countGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const ADMIN_NICKNAME_MAX = 25;

export const ADMIN_TITLE_MAX = 50;

export const AUDIT_REASON_MAX = 500;

export const CATEGORY_NAME_MAX = 30;

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

export const checkCategoryName = (
  value: string,
): 'empty' | 'too-long' | undefined => checkRequired(value, CATEGORY_NAME_MAX);
