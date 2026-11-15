import { inject, injectable } from 'inversify';

import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { checkAccountWritable } from '../../domain/identity/user-account.ts';
import type {
  UploaderEligibility,
  UploaderEligibilityDecision,
  UploaderEligibilityInput,
} from '../media/uploader-eligibility.ts';

const ALLOWED: UploaderEligibilityDecision = Object.freeze({ allowed: true });

const ACCOUNT_UNAVAILABLE: UploaderEligibilityDecision = Object.freeze({
  allowed: false,
  code: 'account_unavailable',
});

// 未確認の利用者もアップロードできる。確認を要する操作へのファイルの紐付けは、その操作の保存が拒否する
@injectable()
export class AccountUploaderEligibility implements UploaderEligibility {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
  ) {}

  async check({
    session,
  }: UploaderEligibilityInput): Promise<UploaderEligibilityDecision> {
    const current = await this.guard.currentUser(session);
    if (current === undefined) {
      return ACCOUNT_UNAVAILABLE;
    }
    const denial = checkAccountWritable(current.user, {
      requireVerifiedEmail: false,
    });
    return denial === undefined ? ALLOWED : ACCOUNT_UNAVAILABLE;
  }
}
