import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { DisposableEmailChecker } from '../../../lib/core/identity/disposable-email.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { RecheckDisposableEmailBody } from '../../../lib/core/messaging/contracts/identity.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_IDENTITY_TYPES } from './event-identity-types.ts';
import type {
  DisposableRecheckSubject,
  DisposableStatusStore,
} from './ports.ts';

type SkipReason = 'missing' | 'withdrawn' | 'unverified' | 'determined';

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'identity', 'disposable-email-recheck']);

function skipReasonOf(
  subject: DisposableRecheckSubject | undefined,
): SkipReason | undefined {
  if (subject === undefined) {
    return 'missing';
  }
  if (subject.withdrawn) {
    return 'withdrawn';
  }
  if (!subject.emailVerified) {
    return 'unverified';
  }
  if (subject.status === 'disposable' || subject.status === 'regular') {
    return 'determined';
  }
  return undefined;
}

// 判定できなくても例外にせず未判定のまま保存する。メッセージの再試行で判定サービスを短い間隔で呼び続けず、日次のジョブが1時間以上後に拾い直す
@injectable()
export class DisposableEmailRecheckHandler implements MessageHandler<RecheckDisposableEmailBody> {
  constructor(
    @inject(EVENT_IDENTITY_TYPES.DisposableStatusStore)
    private readonly store: DisposableStatusStore,
    @inject(EVENT_IDENTITY_TYPES.DisposableEmailChecker)
    private readonly checker: DisposableEmailChecker,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(
    body: RecheckDisposableEmailBody,
  ): Promise<MessageHandlingResult> {
    const subject = await this.store.findSubject(body.userId);
    const skipReason = skipReasonOf(subject);
    if (subject === undefined || skipReason !== undefined) {
      logger.info('判定し直しの対象でないため終えました', {
        userId: body.userId,
        outcome: skipReason,
      });
      return DONE;
    }
    const status = await this.checker.check(subject.email);
    await this.store.saveRecheckResult(
      body.userId,
      subject.email,
      status,
      this.clock.now(),
    );
    logger.info('使い捨てメールアドレスを判定し直しました', {
      userId: body.userId,
      outcome: 'rechecked',
      result: status,
    });
    return DONE;
  }
}
