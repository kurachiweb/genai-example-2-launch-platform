import { trimWhiteSpace } from '../text/white-space.ts';

const DEFAULT_SLUG = 'heading';

const KEPT_CHARACTER = /^[a-z0-9_-]$/u;

const ASCII_UPPERCASE_LETTER = /^[A-Z]$/u;

const utf8Encoder = new TextEncoder();

const percentEncode = (character: string): string =>
  Array.from(
    utf8Encoder.encode(character),
    (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
  ).join('');

const slugifyCharacter = (character: string): string => {
  if (KEPT_CHARACTER.test(character)) {
    return character;
  }
  if (ASCII_UPPERCASE_LETTER.test(character)) {
    return character.toLowerCase();
  }
  if (character === ' ') {
    return '-';
  }
  return percentEncode(character);
};

export const slugifyHeading = (text: string): string => {
  const slug = Array.from(trimWhiteSpace(text), slugifyCharacter).join('');
  return slug === '' ? DEFAULT_SLUG : slug;
};

const decodeFragment = (fragment: string): string => {
  try {
    return decodeURIComponent(fragment);
  } catch (error: unknown) {
    if (error instanceof URIError) {
      return fragment;
    }
    throw error;
  }
};

export const normalizeAnchorFragment = (fragment: string): string =>
  slugifyHeading(decodeFragment(fragment));
