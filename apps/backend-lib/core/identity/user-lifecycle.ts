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

export interface LifecycleRegistration<TType extends string> {
  readonly name: string;
  readonly events: readonly TType[];
  readonly order: number;
}

export interface LifecycleRegistry<
  TType extends string,
  TRegistration extends LifecycleRegistration<TType>,
> {
  handlersFor(type: TType): readonly TRegistration[];
}

export interface LifecycleRegistryOptions {
  // 違反の文言に出す処理の呼び名で、どの登録口の登録を直すべきかを区別する
  readonly handlerLabel: string;
}

export class LifecycleRegistrationError extends Error {
  override readonly name = 'LifecycleRegistrationError';
}

const USER_LIFECYCLE_HANDLER_LABEL = '波及処理';

// <spec名>.<名詞句>の形で、各部分の文字の規則はメッセージの種別と同じにする(例: identity-auth.email-suppression-cleanup)
const HANDLER_NAME_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function assertLifecycleHandlerName(
  name: string,
  handlerLabel: string = USER_LIFECYCLE_HANDLER_LABEL,
): void {
  if (!HANDLER_NAME_PATTERN.test(name)) {
    throw new LifecycleRegistrationError(
      `${handlerLabel}の名前は<spec名>.<名詞句>の形で指定してください: ${JSON.stringify(name)}`,
    );
  }
}

function assertOrder(
  registration: LifecycleRegistration<string>,
  handlerLabel: string,
): void {
  if (!Number.isInteger(registration.order)) {
    throw new LifecycleRegistrationError(
      `${handlerLabel}${JSON.stringify(registration.name)}のorderは整数で指定してください: ${String(registration.order)}`,
    );
  }
}

function assertDistinctEvents(
  registration: LifecycleRegistration<string>,
  handlerLabel: string,
): void {
  const duplicated = registration.events.find(
    (type, index) => registration.events.indexOf(type) !== index,
  );
  if (duplicated !== undefined) {
    throw new LifecycleRegistrationError(
      `${handlerLabel}${JSON.stringify(registration.name)}が種類${JSON.stringify(duplicated)}を重ねて挙げています`,
    );
  }
}

function addToType<TRegistration extends LifecycleRegistration<string>>(
  type: string,
  registrations: TRegistration[],
  registration: TRegistration,
  handlerLabel: string,
): void {
  const colliding = registrations.find(
    ({ order }) => order === registration.order,
  );
  if (colliding !== undefined) {
    throw new LifecycleRegistrationError(
      `種類${JSON.stringify(type)}の${handlerLabel}${JSON.stringify(colliding.name)}と${JSON.stringify(registration.name)}のorderが重複しています: ${String(registration.order)}`,
    );
  }
  registrations.push(registration);
}

function groupByType<
  TType extends string,
  TRegistration extends LifecycleRegistration<TType>,
>(
  registrations: readonly TRegistration[],
  handlerLabel: string,
): Map<TType, TRegistration[]> {
  const names = new Set<string>();
  const byType = new Map<TType, TRegistration[]>();
  for (const registration of registrations) {
    assertLifecycleHandlerName(registration.name, handlerLabel);
    if (names.has(registration.name)) {
      throw new LifecycleRegistrationError(
        `${handlerLabel}の名前が重複しています: ${JSON.stringify(registration.name)}`,
      );
    }
    names.add(registration.name);
    assertOrder(registration, handlerLabel);
    assertDistinctEvents(registration, handlerLabel);
    for (const type of registration.events) {
      const forType = byType.get(type) ?? [];
      addToType(type, forType, registration, handlerLabel);
      byType.set(type, forType);
    }
  }
  return byType;
}

const NO_HANDLERS: readonly never[] = Object.freeze([]);

// ユーザー以外の集約のライフサイクルイベントも、名前・順の検証と並びの規則をこの登録の検証で共有する
export function createLifecycleRegistry<
  TType extends string,
  TRegistration extends LifecycleRegistration<TType>,
>(
  registrations: readonly TRegistration[],
  { handlerLabel }: LifecycleRegistryOptions,
): LifecycleRegistry<TType, TRegistration> {
  const handlersByType = new Map(
    [...groupByType<TType, TRegistration>(registrations, handlerLabel)].map(
      ([type, forType]) => [
        type,
        Object.freeze(
          forType.toSorted((left, right) => left.order - right.order),
        ),
      ],
    ),
  );
  return Object.freeze({
    handlersFor: (type: TType) => handlersByType.get(type) ?? NO_HANDLERS,
  });
}

export function createAsyncLifecycleRegistry(
  registrations: readonly UserLifecycleAsyncRegistration[],
): AsyncLifecycleRegistry {
  return createLifecycleRegistry<
    UserLifecycleEventType,
    UserLifecycleAsyncRegistration
  >(registrations, { handlerLabel: USER_LIFECYCLE_HANDLER_LABEL });
}

export const USER_LIFECYCLE_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 300,
  maxDelaySeconds: 3600,
});

export const LIFECYCLE_CONTINUE_DELAY_SECONDS = 5;
