import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { AuthIncidentReporter } from '../auth/ports.ts';
import { loadCurrentUserRecord } from './current-user-record.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  IdentityMessagePublisher,
  UserAccountStore,
  UserLifecycleCommitter,
  UserRecord,
} from './ports.ts';
import type {
  ReAuthenticationInput,
  ReAuthenticator,
} from './re-authenticator.ts';
import type { RequestMeta } from './request-meta.ts';
import {
  commitUserLifecycleTransition,
  type UserLifecycleTransitionDependencies,
} from './user-lifecycle-transition.ts';

export interface Withdrawal {
  // 呼び出し側が先にAccountGuard.requireUser(停止中も通す)とbot判定を通し、成功したらCookieを失効させる
  withdraw(
    current: CurrentUser,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<void>;
}

// 本人の退会と運営者による退会は、この関数だけで退会を確定させる
export function commitWithdrawal(
  deps: UserLifecycleTransitionDependencies,
  user: UserRecord,
  at: Date,
): Promise<void> {
  return commitUserLifecycleTransition(deps, {
    kind: 'withdraw',
    userId: user.id,
    expectedVersion: user.lifecycleVersion,
    at,
  });
}

@injectable()
export class StoreWithdrawal implements Withdrawal {
  readonly #transition: UserLifecycleTransitionDependencies;

  constructor(
    @inject(IDENTITY_TYPES.ReAuthenticator)
    private readonly reAuthenticator: ReAuthenticator,
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

  async withdraw(
    current: CurrentUser,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await loadCurrentUserRecord(this.users, current);
    await this.reAuthenticator.verify(user, reAuthentication, meta);
    await commitWithdrawal(this.#transition, user, meta.now);
  }
}
