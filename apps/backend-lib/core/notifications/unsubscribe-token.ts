import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../../common-lib/notifications/notification-topics.ts';
import { hashPurpose, type HashPurpose } from '../crypto/keyed-hasher.ts';
import type { ExtraHeaders } from '../email/email-headers.ts';
import { isUppercaseUlid } from '../ids/uppercase-ulid.ts';

export const UNSUBSCRIBE_TOKEN_PURPOSE: HashPurpose = hashPurpose(
  'notification-unsubscribe-token',
);

export const UNSUBSCRIBE_LOOKUP_PURPOSE: HashPurpose = hashPurpose(
  'notification-unsubscribe-lookup',
);

export const UNSUBSCRIBE_SEED_BYTES = 32;

// 32バイトをパディングなしのbase64urlで表すと43文字になり、最後の文字は下位2ビットが0の表記に限られる
const SEED_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
// HMAC-SHA512の64バイトをパディングなしのbase64urlで表すと86文字になり、最後の文字は下位4ビットが0の表記に限られる
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{85}[AQgw]$/u;
const UNSUBSCRIBE_PATH = '/unsubscribe';
const ONE_CLICK_POST_VALUE = 'List-Unsubscribe=One-Click';
const NO_HEADERS: ExtraHeaders = Object.freeze({});

export function unsubscribeTokenSource(input: {
  readonly userId: string;
  readonly topic: NotificationTopic;
  readonly seed: string;
}): string {
  const { userId, topic, seed } = input;
  if (
    !isUppercaseUlid(userId) ||
    !NOTIFICATION_TOPICS.includes(topic) ||
    !SEED_PATTERN.test(seed)
  ) {
    throw new RangeError(
      '配信停止のトークンの導出には、ULIDの利用者のID・通知種別・32バイトの種が必要です',
    );
  }
  return `${userId}:${topic}:${seed}`;
}

export function isWellFormedUnsubscribeToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

function assertToken(token: string): void {
  if (!isWellFormedUnsubscribeToken(token)) {
    throw new RangeError('配信停止のトークンの形式が正しくありません');
  }
}

export function unsubscribePageUrl(
  clientOrigin: string,
  token: string,
): string {
  assertToken(token);
  const url = new URL(UNSUBSCRIBE_PATH, clientOrigin);
  url.hash = `token=${token}`;
  return url.href;
}

export function oneClickUnsubscribeUrl(
  eventOrigin: string,
  token: string,
): string {
  assertToken(token);
  const url = new URL(UNSUBSCRIBE_PATH, eventOrigin);
  url.search = `token=${token}`;
  return url.href;
}

// 送信の追加のヘッダーはHTTPSのURIを求めるため、https:でないローカルのオリジンではヘッダーを付けない
export function listUnsubscribeHeaders(
  eventOrigin: string,
  token: string,
): ExtraHeaders {
  const url = oneClickUnsubscribeUrl(eventOrigin, token);
  if (new URL(eventOrigin).protocol !== 'https:') {
    return NO_HEADERS;
  }
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': ONE_CLICK_POST_VALUE,
  };
}
