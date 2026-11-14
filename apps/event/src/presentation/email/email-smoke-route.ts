import type { Hono } from 'hono';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from '../../../lib/core/email/kinds/email-delivery-smoke.ts';
import type { EmailSender } from '../../../lib/core/email/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import {
  createSmokeNotFoundError,
  createSmokeUnauthenticatedError,
  matchesSmokeToken,
} from '../smoke/smoke-access.ts';

export const EMAIL_SMOKE_PATH = '/internal/email/smoke';

export interface EmailSmokeEnv {
  readonly EMAIL_SMOKE_TOKEN?: string;
  readonly EMAIL_SMOKE_RECIPIENT?: string;
}

interface EmailSmokeSettings {
  readonly token: string;
  readonly recipient: string;
}

function readSettings(env: EmailSmokeEnv): EmailSmokeSettings | undefined {
  const { EMAIL_SMOKE_TOKEN: token, EMAIL_SMOKE_RECIPIENT: recipient } = env;
  if (
    token === undefined ||
    token === '' ||
    recipient === undefined ||
    recipient === ''
  ) {
    return undefined;
  }
  return { token, recipient };
}

// 宛先は要求から受け取らずシークレットの値に固定し、外部から任意の宛先へ送らせない
export function registerEmailSmokeRoute<E extends PlatformEnv & EmailSmokeEnv>(
  app: Hono<PlatformHonoEnv<E>>,
): void {
  app.post(EMAIL_SMOKE_PATH, async (c) => {
    const settings = readSettings(c.env);
    if (settings === undefined) {
      throw createSmokeNotFoundError();
    }
    if (
      !(await matchesSmokeToken(c.req.header('Authorization'), settings.token))
    ) {
      throw createSmokeUnauthenticatedError();
    }
    const container = c.get('container');
    const requestedAt = container
      .get<Clock>(PLATFORM_TYPES.Clock)
      .now()
      .toISOString();
    const requestId = await container
      .get<EmailSender>(EMAIL_TYPES.EmailSender)
      .send({
        kind: EMAIL_DELIVERY_SMOKE_KIND,
        to: settings.recipient,
        input: { requestedAt },
      });
    return c.json({ requestId }, 202, { 'Cache-Control': 'no-store' });
  });
}
