import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  DisposableEmailChecker,
  DisposableEmailStatus,
} from '../../../lib/core/identity/disposable-email.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { RECHECK_DISPOSABLE_EMAIL_MESSAGE } from '../../../lib/core/messaging/contracts/identity.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { AuthIncidentReporter } from '../auth/ports.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  IdentityMessagePublisher,
  UserAccountStore,
  UserRecord,
} from './ports.ts';

export interface DisposableEmailCheck {
  // 判定できなければ「未判定」として保存し、利用者の操作を待たずに判定し直すよう依頼して、運用者へ通知する
  checkAndSave(user: UserRecord, at: Date): Promise<DisposableEmailStatus>;
}

export const DISPOSABLE_RECHECK_DELAY_SECONDS = 15 * 60;

const logger = getAppLogger(['api', 'identity', 'disposable-email-check']);

@injectable()
export class SavingDisposableEmailCheck implements DisposableEmailCheck {
  constructor(
    @inject(IDENTITY_TYPES.DisposableEmailChecker)
    private readonly checker: DisposableEmailChecker,
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: IdentityMessagePublisher,
    @inject(AUTH_TYPES.AuthIncidentReporter)
    private readonly reporter: AuthIncidentReporter,
  ) {}

  async checkAndSave(
    user: UserRecord,
    at: Date,
  ): Promise<DisposableEmailStatus> {
    const status = await this.checker.check(user.email);
    await this.users.saveDisposableStatus(user.id, status, at);
    if (status === 'undetermined') {
      await this.#requestRecheck(user.id);
      this.reporter.report({ kind: 'disposable-email-check-unavailable' });
    }
    return status;
  }

  async #requestRecheck(userId: string): Promise<void> {
    try {
      await this.publisher.publish(
        RECHECK_DISPOSABLE_EMAIL_MESSAGE,
        { userId },
        { delaySeconds: DISPOSABLE_RECHECK_DELAY_SECONDS },
      );
    } catch (error: unknown) {
      // 確認や変更は確定済みで、「未判定」の利用者は日次のジョブが判定し直しを依頼するため、利用者の操作を失敗させない
      logger.error('使い捨て判定の判定し直しを依頼できませんでした', {
        error,
        userId,
      });
    }
  }
}
