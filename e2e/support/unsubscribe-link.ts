import { createHmac, randomBytes } from 'node:crypto';

import type { NotificationTopic } from '../../apps/common-lib/notifications/notification-topics.ts';

// backend-libの導出(core/crypto/keyed-hasher.tsとcore/notifications/unsubscribe-token.ts)はルートの型検査に入れられない型を使うため、同じ方式をNodeの暗号の部品で書く。一致はこのファイルの単体テストがbackend-libを子プロセスで実行して確かめる
const UNSUBSCRIBE_TOKEN_PURPOSE = 'notification-unsubscribe-token';

const UNSUBSCRIBE_LOOKUP_PURPOSE = 'notification-unsubscribe-lookup';

const UNSUBSCRIBE_SEED_BYTES = 32;

const PURPOSE_SEPARATOR = '\u0000';

// apps/eventのpresentation/notifications/one-click-unsubscribe-route.tsのONE_CLICK_UNSUBSCRIBE_PATHの写し。一致はルートのconfig/notification-contract-copies.unit.test.tsが確かめる
export const ONE_CLICK_UNSUBSCRIBE_PATH = '/unsubscribe';

export interface UnsubscribeTokenInput {
  readonly pepper: string;
  readonly userId: string;
  readonly topic: NotificationTopic;
  readonly seed: string;
}

export interface DerivedUnsubscribeToken {
  readonly token: string;
  // 種の行に保存する照合用のハッシュ
  readonly tokenHash: string;
}

const keyedHash = (pepper: string, purpose: string, value: string): string =>
  createHmac('sha512', pepper)
    .update(`${purpose}${PURPOSE_SEPARATOR}${value}`)
    .digest('base64url');

export function createUnsubscribeSeed(): string {
  return randomBytes(UNSUBSCRIBE_SEED_BYTES).toString('base64url');
}

// トークンはAPIサーバー・イベントサーバーと同じペッパーで導出しなければ照合できないため、E2Eテストのコマンドへ注入されたシークレットを受け取る
export function deriveUnsubscribeToken(
  input: UnsubscribeTokenInput,
): DerivedUnsubscribeToken {
  const { pepper, userId, topic, seed } = input;
  if (pepper === '') {
    throw new Error(
      'HASH_PEPPERが注入されていません。infisical --telemetry=false run --env dev -- bun run test:e2e の形で実行してください',
    );
  }
  const token = keyedHash(
    pepper,
    UNSUBSCRIBE_TOKEN_PURPOSE,
    `${userId}:${topic}:${seed}`,
  );
  return {
    token,
    tokenHash: keyedHash(pepper, UNSUBSCRIBE_LOOKUP_PURPOSE, token),
  };
}

export function oneClickUnsubscribeUrl(
  eventOrigin: string,
  token: string,
): string {
  const url = new URL(ONE_CLICK_UNSUBSCRIBE_PATH, eventOrigin);
  url.search = `token=${token}`;
  return url.href;
}
