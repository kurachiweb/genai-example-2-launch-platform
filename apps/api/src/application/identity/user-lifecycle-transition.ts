import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/identity.ts';
import type { AuthIncidentReporter } from '../auth/ports.ts';
import type {
  IdentityMessagePublisher,
  UserLifecycleCommitter,
  UserStateTransition,
} from './ports.ts';

export interface UserLifecycleTransitionDependencies {
  readonly committer: UserLifecycleCommitter;
  readonly publisher: IdentityMessagePublisher;
  readonly reporter: AuthIncidentReporter;
}

const logger = getAppLogger(['api', 'identity', 'user-lifecycle']);

// 版の競合は確定させずにそのまま投げる。送信の失敗はイベントがpendingのまま残り日次のジョブが送り直すため、確定済みの操作を失敗させない
export async function commitUserLifecycleTransition(
  deps: UserLifecycleTransitionDependencies,
  transition: UserStateTransition,
): Promise<void> {
  const event = await deps.committer.commit(transition);
  try {
    await deps.publisher.publish(RUN_USER_LIFECYCLE_MESSAGE, {
      eventId: event.id,
    });
  } catch (error: unknown) {
    logger.error('ユーザーライフサイクルイベントの送信を要求できませんでした', {
      error,
      eventId: event.id,
      userId: transition.userId,
    });
    deps.reporter.report({
      kind: 'lifecycle-publish-failed',
      eventId: event.id,
    });
  }
}
