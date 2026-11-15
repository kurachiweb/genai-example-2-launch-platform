import { z } from 'zod';

import {
  defineMessageContract,
  type MessageContract,
} from '../message-contract.ts';

export interface RunProductLifecycleBody {
  readonly eventId: string;
}

// デッドレターや再試行で本文が運ばれ続けるため、プロダクトの名前・ハンドルを入れず、受信側が記録を読み直す識別子だけを持たせる
const runProductLifecycleBodySchema = z.object({
  eventId: z.ulid(),
});

export const RUN_PRODUCT_LIFECYCLE_MESSAGE: MessageContract<
  'product.run-product-lifecycle',
  RunProductLifecycleBody
> = defineMessageContract(
  'product.run-product-lifecycle',
  runProductLifecycleBodySchema,
);
