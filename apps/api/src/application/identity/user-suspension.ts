import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountStatus } from '../../domain/identity/user-account.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { AuthIncidentReporter } from '../auth/ports.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import { notFoundError } from './not-found.ts';
import type {
  IdentityMessagePublisher,
  UserAccountStore,
  UserLifecycleCommitter,
} from './ports.ts';
import {
  commitUserLifecycleTransition,
  type UserLifecycleTransitionDependencies,
} from './user-lifecycle-transition.ts';

export type SuspensionResult = 'changed' | 'unchanged';

// 操作の権限の確認と監査ログの記録は呼び出し側(運営者の操作)が行う。停止しても既存のセッションは消さない
export interface UserSuspension {
  // 退会済み・存在しない利用者はAppError(not_found)を投げ、既に同じ状態ならunchangedを返す
  suspend(userId: string, at: Date): Promise<SuspensionResult>;
  unsuspend(userId: string, at: Date): Promise<SuspensionResult>;
}

@injectable()
export class StoreUserSuspension implements UserSuspension {
  readonly #transition: UserLifecycleTransitionDependencies;

  constructor(
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(IDENTITY_TYPES.UserLifecycleCommitter)
    committer: UserLifecycleCommitter,
    @inject(PLATFORM_TYPES.MessagePublisher)
    publisher: IdentityMessagePublisher,
    @inject(AUTH_TYPES.AuthIncidentReporter)
    reporter: AuthIncidentReporter,
  ) {
    this.#transition = { committer, publisher, reporter };
  }

  suspend(userId: string, at: Date): Promise<SuspensionResult> {
    return this.#transit(userId, at, 'suspend', 'suspended');
  }

  unsuspend(userId: string, at: Date): Promise<SuspensionResult> {
    return this.#transit(userId, at, 'unsuspend', 'active');
  }

  async #transit(
    userId: string,
    at: Date,
    kind: 'suspend' | 'unsuspend',
    target: AccountStatus,
  ): Promise<SuspensionResult> {
    const user = await this.users.findById(userId);
    if (user === undefined || user.deletedAt !== null) {
      throw notFoundError();
    }
    if (user.status === target) {
      return 'unchanged';
    }
    await commitUserLifecycleTransition(this.#transition, {
      kind,
      userId,
      expectedVersion: user.lifecycleVersion,
      at,
    });
    return 'changed';
  }
}
