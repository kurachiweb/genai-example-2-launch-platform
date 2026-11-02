import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { AuthIncidentReporter } from '../auth/ports.ts';
import type { Principal } from '../session/session-verifier.ts';
import { identityError } from './identity-errors.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  IdentityMessagePublisher,
  UserAccountStore,
  UserLifecycleCommitter,
} from './ports.ts';
import type { UserLifecycleTransitionDependencies } from './user-lifecycle-transition.ts';
import { commitWithdrawal } from './withdrawal.ts';

export interface AdministrativeWithdrawalCommand {
  readonly userId: string;
  // GraphQLContext.caller。application層はpresentation層の呼び出し元の型を読み込めないため、文字列で受ける
  readonly caller: string;
  // GraphQLContext.session.principal()の結果
  readonly operator: Principal;
  readonly at: Date;
}

// 操作の権限の確認と監査ログの記録は呼び出し側が行う。本人確認とbot判定は求めない
export interface AdministrativeWithdrawal {
  // 管理者側の呼び出し元と管理者のセッションでなければAppError(forbidden)、退会済み・存在しない対象はAppError(not_found)を投げる
  withdraw(command: AdministrativeWithdrawalCommand): Promise<void>;
}

export const ADMINISTRATIVE_CALLER = 'admin';

const isAdministrativeRequest = ({
  caller,
  operator,
}: AdministrativeWithdrawalCommand): boolean =>
  caller === ADMINISTRATIVE_CALLER &&
  operator.kind === 'authenticated' &&
  operator.subjectKind === 'admin';

@injectable()
export class StoreAdministrativeWithdrawal implements AdministrativeWithdrawal {
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

  async withdraw(command: AdministrativeWithdrawalCommand): Promise<void> {
    if (!isAdministrativeRequest(command)) {
      throw identityError('forbidden');
    }
    const user = await this.users.findById(command.userId);
    if (user === undefined || user.deletedAt !== null) {
      throw identityError('not_found');
    }
    await commitWithdrawal(this.#transition, user, command.at);
  }
}
