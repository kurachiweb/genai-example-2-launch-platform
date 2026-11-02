import { z } from 'zod';

import {
  defineMessageContract,
  type MessageContract,
} from '../message-contract.ts';

export interface RunUserLifecycleBody {
  readonly eventId: string;
}

export interface RecheckDisposableEmailBody {
  readonly userId: string;
}

// デッドレターや再試行で本文が運ばれ続けるため、メールアドレスなどの個人情報を入れず、受信側が記録を読み直す識別子だけを持たせる
const runUserLifecycleBodySchema = z.object({
  eventId: z.ulid(),
});

const recheckDisposableEmailBodySchema = z.object({
  userId: z.ulid(),
});

export const RUN_USER_LIFECYCLE_MESSAGE: MessageContract<
  'identity.run-user-lifecycle',
  RunUserLifecycleBody
> = defineMessageContract(
  'identity.run-user-lifecycle',
  runUserLifecycleBodySchema,
);

export const RECHECK_DISPOSABLE_EMAIL_MESSAGE: MessageContract<
  'identity.recheck-disposable-email',
  RecheckDisposableEmailBody
> = defineMessageContract(
  'identity.recheck-disposable-email',
  recheckDisposableEmailBodySchema,
);
