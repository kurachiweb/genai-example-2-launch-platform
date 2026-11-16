// `z.ulid()`と`ulid`パッケージの検証は小文字も受け付けるため、採番の表記である大文字だけに限る
export const UPPERCASE_ULID_SOURCE = '[0-9A-HJKMNP-TV-Z]{26}';

export const UPPERCASE_ULID_PATTERN = new RegExp(
  `^${UPPERCASE_ULID_SOURCE}$`,
  'u',
);

export function isUppercaseUlid(value: string): boolean {
  return UPPERCASE_ULID_PATTERN.test(value);
}
