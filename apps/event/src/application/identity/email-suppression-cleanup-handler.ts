import { inject, injectable } from 'inversify';

import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import type { SuppressionMaintenance } from '../../../lib/core/email/ports.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { EVENT_IDENTITY_TYPES } from './event-identity-types.ts';
import type { UserEmailLookup } from './ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

@injectable()
export class EmailSuppressionCleanupHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_IDENTITY_TYPES.UserEmailLookup)
    private readonly emails: UserEmailLookup,
    @inject(EMAIL_TYPES.SuppressionMaintenance)
    private readonly maintenance: SuppressionMaintenance,
  ) {}

  // 物理削除の後に再配信された場合は利用者の行もアドレスも残らないため、消す対象が無いものとして終える
  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const email = await this.emails.findEmail(event.userId);
    if (email !== undefined) {
      await this.maintenance.deleteByAddress(email);
    }
    return DONE;
  }
}
