import type { ServiceIdentifier } from 'inversify';

import type { RetryPolicy } from '../messaging/retry-policy.ts';

export const USER_LIFECYCLE_EVENT_TYPES = Object.freeze([
  'withdrawn',
  'suspended',
  'unsuspended',
  'purge_due',
] as const);

export type UserLifecycleEventType =
  (typeof USER_LIFECYCLE_EVENT_TYPES)[number];

export type SyncLifecycleEventType = Exclude<
  UserLifecycleEventType,
  'purge_due'
>;

export interface UserLifecycleEvent {
  readonly id: string;
  readonly userId: string;
  readonly type: UserLifecycleEventType;
  readonly occurredAt: Date;
}

// continueは1回の呼び出しで終わらなかったことを表し、進み具合は波及処理が自分のデータで判断する
export type LifecycleHandlerOutcome =
  { readonly kind: 'done' } | { readonly kind: 'continue' };

export interface UserLifecycleAsyncHandler {
  handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome>;
}

export interface UserLifecycleAsyncRegistration {
  readonly name: string;
  readonly events: readonly UserLifecycleEventType[];
  readonly order: number;
  readonly handler: ServiceIdentifier<UserLifecycleAsyncHandler>;
}

export interface AsyncLifecycleRegistry {
  handlersFor(
    type: UserLifecycleEventType,
  ): readonly UserLifecycleAsyncRegistration[];
}

export class LifecycleRegistrationError extends Error {
  override readonly name = 'LifecycleRegistrationError';
}

// <spec名>.<名詞句>の形で、各部分の文字の規則はメッセージの種別と同じにする(例: identity-auth.email-suppression-cleanup)
const HANDLER_NAME_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function assertLifecycleHandlerName(name: string): void {
  if (!HANDLER_NAME_PATTERN.test(name)) {
    throw new LifecycleRegistrationError(
      `波及処理の名前は<spec名>.<名詞句>の形で指定してください: ${JSON.stringify(name)}`,
    );
  }
}

function assertOrder(registration: UserLifecycleAsyncRegistration): void {
  if (!Number.isInteger(registration.order)) {
    throw new LifecycleRegistrationError(
      `波及処理${JSON.stringify(registration.name)}のorderは整数で指定してください: ${String(registration.order)}`,
    );
  }
}

function assertDistinctEvents(
  registration: UserLifecycleAsyncRegistration,
): void {
  const duplicated = registration.events.find(
    (type, index) => registration.events.indexOf(type) !== index,
  );
  if (duplicated !== undefined) {
    throw new LifecycleRegistrationError(
      `波及処理${JSON.stringify(registration.name)}が種類${JSON.stringify(duplicated)}を重ねて挙げています`,
    );
  }
}

function addToType(
  type: UserLifecycleEventType,
  registrations: UserLifecycleAsyncRegistration[],
  registration: UserLifecycleAsyncRegistration,
): void {
  const colliding = registrations.find(
    ({ order }) => order === registration.order,
  );
  if (colliding !== undefined) {
    throw new LifecycleRegistrationError(
      `種類${JSON.stringify(type)}の波及処理${JSON.stringify(colliding.name)}と${JSON.stringify(registration.name)}のorderが重複しています: ${String(registration.order)}`,
    );
  }
  registrations.push(registration);
}

function groupByType(
  registrations: readonly UserLifecycleAsyncRegistration[],
): Map<UserLifecycleEventType, UserLifecycleAsyncRegistration[]> {
  const names = new Set<string>();
  const byType = new Map<
    UserLifecycleEventType,
    UserLifecycleAsyncRegistration[]
  >();
  for (const registration of registrations) {
    assertLifecycleHandlerName(registration.name);
    if (names.has(registration.name)) {
      throw new LifecycleRegistrationError(
        `波及処理の名前が重複しています: ${JSON.stringify(registration.name)}`,
      );
    }
    names.add(registration.name);
    assertOrder(registration);
    assertDistinctEvents(registration);
    for (const type of registration.events) {
      const forType = byType.get(type) ?? [];
      addToType(type, forType, registration);
      byType.set(type, forType);
    }
  }
  return byType;
}

const NO_HANDLERS: readonly UserLifecycleAsyncRegistration[] = Object.freeze(
  [],
);

export function createAsyncLifecycleRegistry(
  registrations: readonly UserLifecycleAsyncRegistration[],
): AsyncLifecycleRegistry {
  const handlersByType = new Map(
    [...groupByType(registrations)].map(([type, forType]) => [
      type,
      Object.freeze(
        forType.toSorted((left, right) => left.order - right.order),
      ),
    ]),
  );
  return Object.freeze({
    handlersFor: (type: UserLifecycleEventType) =>
      handlersByType.get(type) ?? NO_HANDLERS,
  });
}

export const USER_LIFECYCLE_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 300,
  maxDelaySeconds: 3600,
});

export const LIFECYCLE_CONTINUE_DELAY_SECONDS = 5;
