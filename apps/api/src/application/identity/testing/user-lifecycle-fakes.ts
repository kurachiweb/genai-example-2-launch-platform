import type { UserLifecycleEvent } from '../../../../lib/core/identity/user-lifecycle.ts';
import type { MessageContract } from '../../../../lib/core/messaging/message-contract.ts';
import type { AuthIncident, AuthIncidentReporter } from '../../auth/ports.ts';
import type {
  IdentityMessagePublisher,
  IdentityPublishOptions,
  UserAccountStore,
  UserLifecycleCommitter,
  UserRecord,
  UserStateTransition,
} from '../ports.ts';
import type {
  ReAuthenticationInput,
  ReAuthenticator,
} from '../re-authenticator.ts';
import type { RequestMeta } from '../request-meta.ts';
import { userOf } from './credential-change-fakes.ts';

export const EVENT_ID = '01JLIFECYCLE00000000000001';

export const MESSAGE_ID = 'message-0001';

const EVENT_TYPE_BY_KIND = Object.freeze({
  withdraw: 'withdrawn',
  suspend: 'suspended',
  unsuspend: 'unsuspended',
} as const);

export interface UserLifecycleFakeOptions {
  readonly user?: UserRecord | undefined;
  readonly reAuthError?: Error;
  readonly commitError?: Error;
  readonly publishError?: Error;
}

export interface PublishedMessage {
  readonly type: string;
  readonly body: unknown;
  readonly options: IdentityPublishOptions | undefined;
}

export interface UserLifecycleRecorded {
  readonly calls: string[];
  readonly reAuthentications: {
    readonly user: UserRecord;
    readonly input: ReAuthenticationInput;
    readonly meta: RequestMeta;
  }[];
  readonly lookups: string[];
  readonly transitions: UserStateTransition[];
  readonly published: PublishedMessage[];
  readonly incidents: AuthIncident[];
}

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

export function createUserLifecycleFakes(
  options: UserLifecycleFakeOptions = {},
) {
  const user = 'user' in options ? options.user : userOf();
  const recorded: UserLifecycleRecorded = {
    calls: [],
    reAuthentications: [],
    lookups: [],
    transitions: [],
    published: [],
    incidents: [],
  };

  const reAuthenticator: ReAuthenticator = {
    verify(target, input, meta) {
      recorded.calls.push('reAuthenticator.verify');
      recorded.reAuthentications.push({ user: target, input, meta });
      return options.reAuthError === undefined
        ? Promise.resolve()
        : Promise.reject(options.reAuthError);
    },
  };

  const users = partialFake<UserAccountStore>({
    findById(userId) {
      recorded.calls.push('users.findById');
      recorded.lookups.push(userId);
      return Promise.resolve(user?.id === userId ? user : undefined);
    },
  });

  const committer: UserLifecycleCommitter = {
    commit(transition) {
      recorded.calls.push('committer.commit');
      recorded.transitions.push(transition);
      if (options.commitError !== undefined) {
        return Promise.reject(options.commitError);
      }
      const event: UserLifecycleEvent = {
        id: EVENT_ID,
        userId: transition.userId,
        type: EVENT_TYPE_BY_KIND[transition.kind],
        occurredAt: transition.at,
      };
      return Promise.resolve(event);
    },
  };

  const publisher: IdentityMessagePublisher = {
    publish<TType extends string, TBody>(
      contract: MessageContract<TType, TBody>,
      body: TBody,
      publishOptions?: IdentityPublishOptions,
    ) {
      recorded.calls.push('publisher.publish');
      recorded.published.push({
        type: contract.type,
        body,
        options: publishOptions,
      });
      return options.publishError === undefined
        ? Promise.resolve(MESSAGE_ID)
        : Promise.reject(options.publishError);
    },
  };

  const reporter: AuthIncidentReporter = {
    report(incident) {
      recorded.calls.push('reporter.report');
      recorded.incidents.push(incident);
    },
  };

  return { reAuthenticator, users, committer, publisher, reporter, recorded };
}
