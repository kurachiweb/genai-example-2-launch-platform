import { z } from 'zod';

export const MAX_EMAIL_ADDRESS_LENGTH = 254;

// WHATWGのHTML仕様のvalid e-mail addressの定義。zodの既定のemail()はトップレベルドメインを必須にするなど定義が異なる
const WHATWG_EMAIL_ADDRESS_PATTERN = z.regexes.html5Email;

export function isValidEmailAddress(value: string): boolean {
  return (
    value.length <= MAX_EMAIL_ADDRESS_LENGTH &&
    WHATWG_EMAIL_ADDRESS_PATTERN.test(value)
  );
}

export function toMatchingKey(address: string): string {
  return address.trim().toLowerCase();
}
