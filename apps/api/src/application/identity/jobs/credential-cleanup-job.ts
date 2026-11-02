import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { USER_SESSION_POLICY } from '../../../domain/auth/session-policy.ts';
import { IDENTITY_TYPES } from '../identity-types.ts';
import type {
  AuthTokenStore,
  LoginChallengeStore,
  TotpCredentialStore,
  UserSessionStore,
} from '../ports.ts';
import { throwIfFailed } from './daily-job-support.ts';

type CleanupTarget =
  'sessions' | 'mailLinks' | 'loginChallenges' | 'totpPendings';

const logger = getAppLogger(['api', 'identity', 'credential-cleanup']);

// 各ストアの削除は期限ちょうどを期限切れとし、テーブルごとに条件付きの1文で件数の上限なく消す
@injectable()
export class CredentialCleanupJob implements ScheduledJobHandler {
  constructor(
    @inject(IDENTITY_TYPES.UserSessionStore)
    private readonly sessions: UserSessionStore,
    @inject(IDENTITY_TYPES.AuthTokenStore)
    private readonly authTokens: AuthTokenStore,
    @inject(IDENTITY_TYPES.LoginChallengeStore)
    private readonly loginChallenges: LoginChallengeStore,
    @inject(IDENTITY_TYPES.TotpCredentialStore)
    private readonly totpCredentials: TotpCredentialStore,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const deletions: readonly (readonly [
      CleanupTarget,
      () => Promise<number>,
    ])[] = [
      [
        'sessions',
        () => this.sessions.deleteExpired(scheduledTime, USER_SESSION_POLICY),
      ],
      ['mailLinks', () => this.authTokens.deleteExpired(scheduledTime)],
      [
        'loginChallenges',
        () => this.loginChallenges.deleteExpired(scheduledTime),
      ],
      [
        'totpPendings',
        () => this.totpCredentials.deleteExpiredPending(scheduledTime),
      ],
    ];
    const deleted: Partial<Record<CleanupTarget, number>> = {};
    const errors: unknown[] = [];
    for (const [target, deleteExpired] of deletions) {
      try {
        deleted[target] = await deleteExpired();
      } catch (error: unknown) {
        logger.error('期限切れの認証情報を削除できませんでした', {
          error,
          target,
        });
        errors.push(error);
      }
    }
    logger.info('期限切れの認証情報を削除しました', {
      ...deleted,
      failed: errors.length,
    });
    throwIfFailed(
      errors,
      `期限切れの認証情報の削除で${String(errors.length)}件の対象に失敗しました`,
    );
  }
}
