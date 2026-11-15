import type { ServiceIdentifier } from 'inversify';

import {
  createLifecycleRegistry,
  type LifecycleHandlerOutcome,
  LifecycleRegistrationError,
} from '../identity/user-lifecycle.ts';
import type { RetryPolicy } from '../messaging/retry-policy.ts';
import { MATCH_KINDS, type MatchKind } from './match-model.ts';

export const MATCH_EVENT_TYPES = Object.freeze([
  'scheduled',
  'started',
  'decided',
] as const);

export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

export const MATCH_EVENT_STATUSES = Object.freeze([
  'pending',
  'completed',
] as const);

export type MatchEventStatus = (typeof MATCH_EVENT_STATUSES)[number];

export interface MatchEvent {
  readonly id: string;
  readonly matchId: string;
  readonly kind: MatchKind;
  readonly type: MatchEventType;
  readonly occurredAt: Date;
}

export interface MatchEventHandler {
  handle(event: MatchEvent): Promise<LifecycleHandlerOutcome>;
}

export interface MatchEventRegistration {
  readonly name: string;
  readonly events: readonly MatchEventType[];
  readonly kinds?: readonly MatchKind[];
  readonly order: number;
  readonly handler: ServiceIdentifier<MatchEventHandler>;
}

export interface MatchEventRegistry {
  handlersFor(
    event: Pick<MatchEvent, 'type' | 'kind'>,
  ): readonly MatchEventRegistration[];
}

export const MATCH_EVENT_HANDLER_LABEL = 'マッチイベントの処理';

function assertKinds(registration: MatchEventRegistration): void {
  const { kinds, name } = registration;
  if (kinds === undefined) {
    return;
  }
  if (kinds.length === 0) {
    throw new LifecycleRegistrationError(
      `${MATCH_EVENT_HANDLER_LABEL}${JSON.stringify(name)}の対象の種別は省くか1つ以上指定してください`,
    );
  }
  const duplicated = kinds.find((kind, index) => kinds.indexOf(kind) !== index);
  if (duplicated !== undefined) {
    throw new LifecycleRegistrationError(
      `${MATCH_EVENT_HANDLER_LABEL}${JSON.stringify(name)}が種別${JSON.stringify(duplicated)}を重ねて挙げています`,
    );
  }
}

function tableKey(type: MatchEventType, kind: MatchKind): string {
  return `${type}:${kind}`;
}

const NO_HANDLERS: readonly never[] = Object.freeze([]);

// orderの重複は種別の指定によらず種類ごとに拒否し、同じ種類の処理の実行順を種別の組み合わせに依存させない
export function createMatchEventRegistry(
  registrations: readonly MatchEventRegistration[],
): MatchEventRegistry {
  const byType = createLifecycleRegistry<
    MatchEventType,
    MatchEventRegistration
  >(registrations, { handlerLabel: MATCH_EVENT_HANDLER_LABEL });
  for (const registration of registrations) {
    assertKinds(registration);
  }
  const table = new Map<string, readonly MatchEventRegistration[]>();
  for (const type of MATCH_EVENT_TYPES) {
    for (const kind of MATCH_KINDS) {
      table.set(
        tableKey(type, kind),
        Object.freeze(
          byType
            .handlersFor(type)
            .filter(({ kinds }) => kinds === undefined || kinds.includes(kind)),
        ),
      );
    }
  }
  return Object.freeze({
    handlersFor: ({ type, kind }: Pick<MatchEvent, 'type' | 'kind'>) =>
      table.get(tableKey(type, kind)) ?? NO_HANDLERS,
  });
}

export const MATCH_EVENT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 300,
  maxDelaySeconds: 3600,
});
