import { z } from 'zod';

import { defineEmailKind } from '../email-kind.ts';

const emailDeliverySmokeInput = z.object({ requestedAt: z.iso.datetime() });

export type EmailDeliverySmokeInput = z.infer<typeof emailDeliverySmokeInput>;

export const EMAIL_DELIVERY_SMOKE_KIND = defineEmailKind({
  name: 'email-delivery.smoke',
  category: 'transactional',
  inputSchema: emailDeliverySmokeInput,
});
