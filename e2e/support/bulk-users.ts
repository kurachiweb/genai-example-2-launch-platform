import { randomBytes, randomUUID } from 'node:crypto';

import {
  type APIRequestContext,
  type Page,
  request as playwrightRequest,
} from '@playwright/test';

import { ClientLoginDocument } from '../../apps/client/src/graphql/generated/graphql.ts';
import { GRAPHQL_RELAY_PATH } from '../../apps/frontend-lib/server/relay/relay-contract.ts';
import { documentIdOf } from '../../apps/frontend-lib/utilities/graphql/persisted-document.ts';
import {
  createTestAccount,
  registerAccount,
  verifyEmailFromMail,
} from '../client/auth/account-steps.ts';
import {
  BULK_CLIENT_IP_POOL_SIZE,
  type BulkUserSeed,
  type BulkUserTemplate,
  bulkUserSeed,
  bulkUsersInsertSqls,
  clientIpOf,
  parseBulkUsersInsert,
  parsePasswordHashLookup,
  passwordHashLookupSql,
} from './bulk-users-sql.ts';
import { CONNECTING_IP_HEADER } from './client-ip.ts';
import { fixtureId, ID_RANDOM_BYTES } from './directory-fixture-sql.ts';
import { executeLocalD1, type LocalD1Row } from './local-d1.ts';

export interface BulkUser {
  readonly userId: string;
  readonly email: string;
  readonly clientIp: string;
  // 全員が共有する。実行ごとに乱数から作り、ソースへ値を書かない
  readonly password: string;
}

// Turnstileのテスト用のサイトキーのウィジェットが発行するダミーのトークンで、テスト用の秘密鍵の検証を通る
export const BULK_BOT_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const SUFFIX_BYTES = 4;

const MAX_BULK_USERS = BULK_CLIENT_IP_POOL_SIZE;

const LOGIN_SUCCEEDED = 'LoginSucceeded';

const LOGIN_DOCUMENT_ID = documentIdOf(ClientLoginDocument);

const randomOffset = (): number =>
  randomBytes(2).readUInt16BE() % BULK_CLIENT_IP_POOL_SIZE;

const nextSeed = (suffix: string, index: number): BulkUserSeed =>
  bulkUserSeed({
    suffix,
    index,
    id: fixtureId(new Date(), randomBytes(ID_RANDOM_BYTES)),
    pseudonymousId: randomUUID(),
  });

// wranglerへ渡すSQLは1つのコマンドライン引数になるため、人数が多いときは塊ごとに別の実行で投入する
async function insertSeeds(
  seeds: readonly BulkUserSeed[],
  template: BulkUserTemplate,
): Promise<void> {
  if (seeds.length === 0) {
    return;
  }
  const now = new Date();
  const sqls = bulkUsersInsertSqls(seeds, template, now);
  const created: LocalD1Row[] = [];
  for (const sql of sqls) {
    created.push(...(await executeLocalD1(sql)));
  }
  parseBulkUsersInsert(created, seeds);
}

// 1人目は画面の登録とメールの確認で作る。保存したパスワードのハッシュはソルトを含むため、同じ文字列を持つ利用者は同じパスワードで照合が通り、ハッシュの計算も鍵(HASH_PEPPER)も要らない
export async function createBulkUsers(
  page: Page,
  count: number,
): Promise<readonly BulkUser[]> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BULK_USERS) {
    throw new RangeError(
      `利用者の数は1〜${String(MAX_BULK_USERS)}で指定してください: ${String(count)}`,
    );
  }
  const account = createTestAccount();
  await registerAccount(page, account);
  await verifyEmailFromMail(page, account);
  const first = parsePasswordHashLookup(
    await executeLocalD1(passwordHashLookupSql(account.email)),
    account.email,
  );
  const suffix = randomBytes(SUFFIX_BYTES).toString('hex');
  const seeds = Array.from({ length: count - 1 }, (_, position) =>
    nextSeed(suffix, position + 1),
  );
  await insertSeeds(seeds, first);
  const offset = randomOffset();
  return [
    { userId: first.userId, email: account.email },
    ...seeds.map(({ id, email }) => ({ userId: id, email })),
  ].map((user, index) => ({
    ...user,
    clientIp: clientIpOf(index, offset),
    password: account.password,
  }));
}

const loginFailure = (email: string, status: number, body: string): Error =>
  new Error(
    `利用者${email}のログインに失敗しました: 状態コード${String(status)} ${body.slice(0, 300)}`,
  );

const isLoginSucceeded = (body: unknown): boolean => {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return false;
  }
  const { data } = body;
  if (typeof data !== 'object' || data === null || !('login' in data)) {
    return false;
  }
  const { login } = data;
  return (
    typeof login === 'object' &&
    login !== null &&
    '__typename' in login &&
    login.__typename === LOGIN_SUCCEEDED
  );
};

// 画面と同じ経路(フロントエンドサーバーの中継)でログインし、セッションのCookieを持つ文脈を返す。送信元はこの利用者の文書用のIPアドレスに固定し、CSRFの検査のためOriginを対象のオリジンにする。呼び出し側が`dispose`する
export async function signedInRequest(
  user: BulkUser,
  baseURL: string,
): Promise<APIRequestContext> {
  const origin = new URL(baseURL).origin;
  const context = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      Origin: origin,
      [CONNECTING_IP_HEADER]: user.clientIp,
    },
  });
  try {
    const response = await context.post(GRAPHQL_RELAY_PATH, {
      headers: {
        accept: 'application/graphql-response+json',
        'cf-turnstile-response': BULK_BOT_TOKEN,
      },
      data: {
        documentId: LOGIN_DOCUMENT_ID,
        variables: {
          input: { email: user.email, password: user.password },
        },
      },
    });
    const text = await response.text();
    if (!response.ok() || !isLoginSucceeded(JSON.parse(text))) {
      throw loginFailure(user.email, response.status(), text);
    }
    return context;
  } catch (error) {
    await context.dispose();
    throw error;
  }
}
