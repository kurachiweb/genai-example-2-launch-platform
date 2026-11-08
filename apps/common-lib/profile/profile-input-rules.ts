import {
  type HandleRule,
  IMPERSONATION_RESERVED_HANDLES,
} from '../handles/handle-rules.ts';
import { countGraphemes } from '../text/graphemes.ts';
import { hasForbiddenCharacters } from '../text/text-safety.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const USER_HANDLE_RULE: HandleRule = Object.freeze({
  maxLength: 25,
  reservedWords: IMPERSONATION_RESERVED_HANDLES,
});

export const HEADLINE_MAX_GRAPHEMES = 50;

export const BIO_MAX_GRAPHEMES = 5000;

export const WEBSITE_NAME_MAX_GRAPHEMES = 25;

export const PROFILE_WEBSITES_MAX = 10;

export const USER_AVATAR_PURPOSE = 'user-avatar';

export const USER_AVATAR_MAX_BYTES = 512_000;

export type OptionalTextCheck = 'ok' | 'too-long' | 'forbidden-characters';

const checkOptionalText = (value: string, max: number): OptionalTextCheck => {
  // VT・FF・NELは空白でもあるため、前後の空白を除く前に調べて、端にあっても黙って除かずに拒む
  if (hasForbiddenCharacters(value)) {
    return 'forbidden-characters';
  }
  return countGraphemes(trimWhiteSpace(value)) > max ? 'too-long' : 'ok';
};

export const checkHeadline = (value: string): OptionalTextCheck =>
  checkOptionalText(value, HEADLINE_MAX_GRAPHEMES);

export const checkWebsiteName = (value: string): OptionalTextCheck =>
  checkOptionalText(value, WEBSITE_NAME_MAX_GRAPHEMES);
