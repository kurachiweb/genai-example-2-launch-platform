import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { ADMIN_SESSION_POLICY } from '../../../domain/admin/admin-session-policy.ts';
import { ADMIN_TYPES } from '../admin-types.ts';
import type {
  AdminAuthTokenStore,
  AdminLoginChallengeStore,
  AdminSessionStore,
  AdminTotpCredentialStore,
} from '../ports.ts';

// Workersのcpu時間に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const ADMIN_CREDENTIAL_CLEANUP_LIMIT = 500;

type CleanupTarget =
  'sessions' | 'mailLinks' | 'loginChallenges' | 'totpPendings';

const logger = getAppLogger(['api', 'admin', 'credential-cleanup']);

export class AdminDailyJobError extends Error {
  override readonly name = 'AdminDailyJobError';
}

@injectable()
export class AdminCredentialCleanupJob implements ScheduledJobHandler {
  constructor(
    @inject(ADMIN_TYPES.AdminSessionStore)
    private readonly sessions: AdminSessionStore,
    @inject(ADMIN_TYPES.AdminAuthTokenStore)
    private readonly authTokens: AdminAuthTokenStore,
    @inject(ADMIN_TYPES.AdminLoginChallengeStore)
    private readonly loginChallenges: AdminLoginChallengeStore,
    @inject(ADMIN_TYPES.AdminTotpCredentialStore)
    private readonly totpCredentials: AdminTotpCredentialStore,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const limit = ADMIN_CREDENTIAL_CLEANUP_LIMIT;
    const deletions: readonly (readonly [
      CleanupTarget,
      () => Promise<number>,
    ])[] = [
      [
        'sessions',
        () =>
          this.sessions.deleteExpired(
            scheduledTime,
            ADMIN_SESSION_POLICY,
            limit,
          ),
      ],
      ['mailLinks', () => this.authTokens.deleteExpired(scheduledTime, limit)],
      [
        'loginChallenges',
        () => this.loginChallenges.deleteExpired(scheduledTime, limit),
      ],
      [
        'totpPendings',
        () => this.totpCredentials.clearExpiredPending(scheduledTime, limit),
      ],
    ];
    const deleted: Partial<Record<CleanupTarget, number>> = {};
    const errors: unknown[] = [];
    for (const [target, deleteExpired] of deletions) {
      try {
        deleted[target] = await deleteExpired();
      } catch (error: unknown) {
        logger.error('期限切れの管理者の認証情報を削除できませんでした', {
          error,
          target,
        });
        errors.push(error);
      }
    }
    logger.info('期限切れの管理者の認証情報を削除しました', {
      ...deleted,
      failed: errors.length,
    });
    // 1件の失敗で残りの対象を止めず、失敗はまとめて1件の例外にしてディスパッチャからエラートラッキングへ送る
    if (errors.length > 0) {
      throw new AdminDailyJobError(
        `期限切れの管理者の認証情報の削除で${String(errors.length)}件の対象に失敗しました`,
        { cause: errors[0] },
      );
    }
  }
}
