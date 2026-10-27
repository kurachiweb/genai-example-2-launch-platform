import type { Hono } from 'hono';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from '../../../lib/core/email/kinds/email-delivery-smoke.ts';
import type { EmailSender } from '../../../lib/core/email/ports.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';

export const EMAIL_SMOKE_PATH = '/internal/email/smoke';

export interface EmailSmokeEnv {
  readonly EMAIL_SMOKE_TOKEN?: string;
  readonly EMAIL_SMOKE_RECIPIENT?: string;
}

interface EmailSmokeSettings {
  readonly token: string;
  readonly recipient: string;
}

const BEARER_CREDENTIALS_PATTERN = /^Bearer (.+)$/iu;

const textEncoder = new TextEncoder();

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

// 経路の存在を明かさないよう、未登録の経路と同じ定型の404にする
function createNotFoundError(): AppError {
  return new AppError({
    kind: 'not_found',
    code: NOT_FOUND_RESPONSE.body.error.code,
    message: NOT_FOUND_RESPONSE.body.error.message,
  });
}

function createUnauthenticatedError(): AppError {
  return new AppError({
    kind: 'unauthenticated',
    code: 'unauthenticated',
    message: '認証されていません。',
  });
}

function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', textEncoder.encode(value));
}

// 比べる時間から正しいトークンの長さや一致した位置を推測させないよう、同じ長さのハッシュ値どうしを時間一定で比べる
async function matchesToken(
  authorization: string | undefined,
  token: string,
): Promise<boolean> {
  const presented = BEARER_CREDENTIALS_PATTERN.exec(authorization ?? '')?.[1];
  if (presented === undefined) {
    return false;
  }
  const [presentedHash, tokenHash] = await Promise.all([
    sha256(presented),
    sha256(token),
  ]);
  return crypto.subtle.timingSafeEqual(presentedHash, tokenHash);
}

// 宛先は要求から受け取らずシークレットの値に固定し、外部から任意の宛先へ送らせない
export function registerEmailSmokeRoute<E extends PlatformEnv & EmailSmokeEnv>(
  app: Hono<PlatformHonoEnv<E>>,
): void {
  app.post(EMAIL_SMOKE_PATH, async (c) => {
    const settings = readSettings(c.env);
    if (settings === undefined) {
      throw createNotFoundError();
    }
    if (!(await matchesToken(c.req.header('Authorization'), settings.token))) {
      throw createUnauthenticatedError();
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
