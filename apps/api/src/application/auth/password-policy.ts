import { inject, injectable } from 'inversify';

import {
  checkPasswordRules,
  type PasswordIdentifiers,
  type PasswordRuleViolation,
} from '../../domain/auth/password-rules.ts';
import { AUTH_TYPES } from './auth-types.ts';
import type { AuthIncidentReporter, PwnedPasswordChecker } from './ports.ts';

export type NewPasswordValidation =
  | { readonly ok: true; readonly pwnedCheck: 'checked' | 'skipped' }
  | { readonly ok: false; readonly violation: PasswordRuleViolation | 'pwned' };

export interface PasswordPolicy {
  validateNewPassword(
    password: string,
    identifiers: PasswordIdentifiers,
  ): Promise<NewPasswordValidation>;
}

@injectable()
export class CheckingPasswordPolicy implements PasswordPolicy {
  constructor(
    @inject(AUTH_TYPES.PwnedPasswordChecker)
    private readonly pwnedChecker: PwnedPasswordChecker,
    @inject(AUTH_TYPES.AuthIncidentReporter)
    private readonly reporter: AuthIncidentReporter,
  ) {}

  async validateNewPassword(
    password: string,
    identifiers: PasswordIdentifiers,
  ): Promise<NewPasswordValidation> {
    // 規則に反するパスワードは外部の照合サービスへ送る必要が無いため、先に規則で落とす
    const violation = checkPasswordRules(password, identifiers);
    if (violation !== undefined) {
      return { ok: false, violation };
    }
    const result = await this.pwnedChecker.check(password);
    switch (result.kind) {
      case 'pwned':
        return { ok: false, violation: 'pwned' };
      case 'not-pwned':
        return { ok: true, pwnedCheck: 'checked' };
      case 'unavailable':
        this.reporter.report({
          kind: 'pwned-password-check-unavailable',
          reason: result.reason,
        });
        return { ok: true, pwnedCheck: 'skipped' };
    }
  }
}
