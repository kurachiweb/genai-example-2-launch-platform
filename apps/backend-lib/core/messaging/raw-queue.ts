import type { ServiceIdentifier } from 'inversify';

import type { RetryPolicy } from './retry-policy.ts';

export interface RawMessageMeta {
  readonly id: string;
  readonly attempts: number;
  readonly timestamp: Date;
}

export interface RawMessageHandler {
  handle(body: unknown, meta: RawMessageMeta): Promise<void>;
}

export interface RawQueueRegistration<E> {
  readonly name: string;
  readonly queueName: (env: E) => string;
  readonly handler: ServiceIdentifier<RawMessageHandler>;
  readonly retry?: Partial<RetryPolicy>;
}

export class RawQueueRegistrationError extends Error {
  override readonly name = 'RawQueueRegistrationError';
}

// 小文字の英数字をハイフンでつなぐ(例: email-delivery-events)
const RAW_QUEUE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function toRawMessageType(name: string): string {
  return `raw:${name}`;
}

function assertName(name: string, seenNames: Set<string>): void {
  if (!RAW_QUEUE_NAME_PATTERN.test(name)) {
    throw new RawQueueRegistrationError(
      `封筒を持たないQueueの登録の名前は小文字の英数字をハイフンでつないだ形で指定してください: ${JSON.stringify(name)}`,
    );
  }
  if (seenNames.has(name)) {
    throw new RawQueueRegistrationError(
      `封筒を持たないQueueの登録の名前が重複しています: ${JSON.stringify(name)}`,
    );
  }
  seenNames.add(name);
}

function assertQueueName(
  name: string,
  queueName: unknown,
  reserved: ReadonlySet<string>,
  seenQueueNames: Set<string>,
): void {
  if (typeof queueName !== 'string' || queueName === '') {
    throw new RawQueueRegistrationError(
      `封筒を持たないQueueの登録のQueue名が空です: ${JSON.stringify(name)}`,
    );
  }
  if (reserved.has(queueName)) {
    throw new RawQueueRegistrationError(
      `封筒を持たないQueueの登録のQueue名が本体またはデッドレターと同じです: ${JSON.stringify(name)} → ${queueName}`,
    );
  }
  if (seenQueueNames.has(queueName)) {
    throw new RawQueueRegistrationError(
      `封筒を持たないQueueの登録のQueue名が重複しています: ${JSON.stringify(name)} → ${queueName}`,
    );
  }
  seenQueueNames.add(queueName);
}

export function assertRawQueueRegistrations<E>(
  registrations: readonly RawQueueRegistration<E>[],
  reservedQueueNames: readonly string[],
  env: E,
): void {
  const reserved = new Set(reservedQueueNames);
  const seenNames = new Set<string>();
  const seenQueueNames = new Set<string>();
  for (const { name, queueName } of registrations) {
    assertName(name, seenNames);
    assertQueueName(name, queueName(env), reserved, seenQueueNames);
  }
}
