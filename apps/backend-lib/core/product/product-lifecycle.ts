import type { ServiceIdentifier } from 'inversify';

import {
  createLifecycleRegistry,
  type LifecycleHandlerOutcome,
  type LifecycleRegistry,
} from '../identity/user-lifecycle.ts';
import type { RetryPolicy } from '../messaging/retry-policy.ts';

export const PRODUCT_LIFECYCLE_EVENT_TYPES = Object.freeze([
  'deleted',
  'hidden',
  'unhidden',
  'purge_due',
] as const);

export type ProductLifecycleEventType =
  (typeof PRODUCT_LIFECYCLE_EVENT_TYPES)[number];

export type SyncProductLifecycleEventType = Exclude<
  ProductLifecycleEventType,
  'purge_due'
>;

export const PRODUCT_LIFECYCLE_EVENT_STATUSES = Object.freeze([
  'pending',
  'completed',
] as const);

export type ProductLifecycleEventStatus =
  (typeof PRODUCT_LIFECYCLE_EVENT_STATUSES)[number];

// deletedは投稿者による個別の論理削除だけで、退会による論理削除はユーザーライフサイクルのwithdrawnで伝わる
export interface ProductLifecycleEvent {
  readonly id: string;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly type: ProductLifecycleEventType;
  readonly occurredAt: Date;
}

export interface ProductLifecycleAsyncHandler {
  handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome>;
}

export interface ProductLifecycleAsyncRegistration {
  readonly name: string;
  readonly events: readonly ProductLifecycleEventType[];
  readonly order: number;
  readonly handler: ServiceIdentifier<ProductLifecycleAsyncHandler>;
}

export type ProductLifecycleRegistry = LifecycleRegistry<
  ProductLifecycleEventType,
  ProductLifecycleAsyncRegistration
>;

export const PRODUCT_LIFECYCLE_HANDLER_LABEL = 'プロダクトライフサイクルの処理';

export function createProductLifecycleRegistry(
  registrations: readonly ProductLifecycleAsyncRegistration[],
): ProductLifecycleRegistry {
  return createLifecycleRegistry<
    ProductLifecycleEventType,
    ProductLifecycleAsyncRegistration
  >(registrations, { handlerLabel: PRODUCT_LIFECYCLE_HANDLER_LABEL });
}

export const PRODUCT_LIFECYCLE_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 300,
  maxDelaySeconds: 3600,
});
