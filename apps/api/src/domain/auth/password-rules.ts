import { checkPasswordLength } from '../../../common-lib/identity/account-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';

export type PasswordRuleViolation =
  'too-short' | 'too-long' | 'matches-identity';

export interface PasswordIdentifiers {
  readonly handle?: string | undefined;
  readonly nickname?: string | undefined;
  readonly email?: string | undefined;
}

const localPartOf = (email: string): string | undefined => {
  const separator = email.lastIndexOf('@');
  return separator > 0 ? email.slice(0, separator) : undefined;
};

// ニックネームは前後の空白を除いて保存されるため、判定と保存値を食い違わせないよう同じ除き方で比べる
const comparableIdentifiers = (
  identifiers: PasswordIdentifiers,
): readonly string[] =>
  [
    identifiers.handle,
    identifiers.nickname === undefined
      ? undefined
      : trimWhiteSpace(identifiers.nickname),
    identifiers.email,
    identifiers.email === undefined
      ? undefined
      : localPartOf(identifiers.email),
  ].filter((value): value is string => value !== undefined && value !== '');

export const checkPasswordRules = (
  password: string,
  identifiers: PasswordIdentifiers,
): PasswordRuleViolation | undefined => {
  const length = checkPasswordLength(password);
  if (length !== 'ok') {
    return length;
  }
  const lowered = password.toLowerCase();
  return comparableIdentifiers(identifiers).some(
    (identifier) => identifier.toLowerCase() === lowered,
  )
    ? 'matches-identity'
    : undefined;
};
