import type { Context, Hono } from 'hono';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  isWellFormedUnsubscribeToken,
  unsubscribePageUrl,
} from '../../../lib/core/notifications/unsubscribe-token.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../../application/notifications/event-notifications-types.ts';
import type { OneClickUnsubscribe } from '../../application/notifications/one-click-unsubscribe.ts';

export const ONE_CLICK_UNSUBSCRIBE_PATH = '/unsubscribe';

const NO_STORE = { 'Cache-Control': 'no-store' };

const UNSUBSCRIBED_MESSAGE = '配信を停止しました。';

const INVALID_LINK_MESSAGE = 'このリンクは無効です。';

// 配信停止ページはclientに置くため、移動先のオリジンを環境から受け取る
export interface OneClickUnsubscribeEnv extends PlatformEnv {
  readonly CLIENT_SITE_ORIGIN: string;
}

type OneClickContext<E extends OneClickUnsubscribeEnv> = Context<
  PlatformHonoEnv<E>
>;

// RFC 8058のメールソフトの要求は共通エラー形式のJSONを解釈しないため、AppErrorを投げずに短い文の本文で返す。本文(List-Unsubscribe=One-Click)は読まない
async function unsubscribe<E extends OneClickUnsubscribeEnv>(
  c: OneClickContext<E>,
): Promise<Response> {
  const token = c.req.query('token');
  if (token === undefined || !isWellFormedUnsubscribeToken(token)) {
    return c.text(INVALID_LINK_MESSAGE, 400, NO_STORE);
  }
  const container = c.get('container');
  const result = await container
    .get<OneClickUnsubscribe>(EVENT_NOTIFICATIONS_TYPES.OneClickUnsubscribe)
    .execute(token, container.get<Clock>(PLATFORM_TYPES.Clock).now());
  if (result.kind === 'invalid') {
    return c.text(INVALID_LINK_MESSAGE, 404, NO_STORE);
  }
  return c.text(UNSUBSCRIBED_MESSAGE, 200, NO_STORE);
}

// リンクの事前取得で止まらないよう、GETでは停止せず配信停止ページの確認へ移す。トークンはサーバーへ送られないフラグメントに載せる
function redirectToPage<E extends OneClickUnsubscribeEnv>(
  c: OneClickContext<E>,
): Response {
  const token = c.req.query('token');
  const clientOrigin = c.env.CLIENT_SITE_ORIGIN;
  const location =
    token !== undefined && isWellFormedUnsubscribeToken(token)
      ? unsubscribePageUrl(clientOrigin, token)
      : new URL(ONE_CLICK_UNSUBSCRIBE_PATH, clientOrigin).href;
  return c.body(null, 303, { ...NO_STORE, Location: location });
}

export function registerOneClickUnsubscribeRoute<
  E extends OneClickUnsubscribeEnv,
>(app: Hono<PlatformHonoEnv<E>>): void {
  app.post(ONE_CLICK_UNSUBSCRIBE_PATH, unsubscribe<E>);
  app.get(ONE_CLICK_UNSUBSCRIBE_PATH, redirectToPage<E>);
}
