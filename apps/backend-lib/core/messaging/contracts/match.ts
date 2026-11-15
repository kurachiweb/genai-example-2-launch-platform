import { z } from 'zod';

import {
  defineMessageContract,
  type MessageContract,
} from '../message-contract.ts';

export interface RunMatchEventBody {
  readonly eventId: string;
}

// デッドレターや再試行で本文が運ばれ続けるため、プロダクトの名称や利用者の情報を入れず、受信側が記録を読み直す識別子だけを持たせる
const runMatchEventBodySchema = z.object({
  eventId: z.ulid(),
});

export const RUN_MATCH_EVENT_MESSAGE: MessageContract<
  'match.run-match-event',
  RunMatchEventBody
> = defineMessageContract('match.run-match-event', runMatchEventBodySchema);
