import type { ServiceIdentifier } from 'inversify';
import type { z } from 'zod';

import type { RetryPolicy } from './retry-policy.ts';

export interface MessageContract<TType extends string, TBody> {
  readonly type: TType;
  readonly schema: z.ZodType<TBody>;
}

export interface MessageMeta {
  readonly id: string;
  readonly type: string;
  readonly attempts: number;
  readonly sentAt: Date;
}

export type MessageHandlingResult =
  | { readonly kind: 'done' }
  | { readonly kind: 'defer'; readonly delaySeconds: number };

export interface MessageHandler<TBody> {
  handle(body: TBody, meta: MessageMeta): Promise<MessageHandlingResult>;
}

export interface MessageHandlerRegistration<TBody> {
  readonly contract: MessageContract<string, TBody>;
  readonly handler: ServiceIdentifier<MessageHandler<TBody>>;
  readonly retry?: Partial<RetryPolicy>;
}

// <ドメイン>.<動詞句>の形で、それぞれ小文字の英数字をハイフンでつなぐ(例: media.purge-image-cache)
const MESSAGE_TYPE_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function defineMessageContract<TType extends string, TBody>(
  type: TType,
  schema: z.ZodType<TBody>,
): MessageContract<TType, TBody> {
  if (!MESSAGE_TYPE_PATTERN.test(type)) {
    throw new RangeError(
      `メッセージの種別は<ドメイン>.<動詞句>の形で指定してください: ${JSON.stringify(type)}`,
    );
  }
  return Object.freeze({ type, schema });
}
