import { randomBytes } from 'node:crypto';

import type { NotificationTopic } from '../../apps/common-lib/notifications/notification-topics.ts';
import { fixtureId, ID_RANDOM_BYTES } from './directory-fixture-sql.ts';
import { executeLocalD1 } from './local-d1.ts';
import {
  parseSenderInfoSnapshot,
  parseUnsubscribeLinkInsert,
  parseUserId,
  SENDER_INFO_SNAPSHOT_SQL,
  senderInfoRestoreSql,
  type SenderInfoSnapshot,
  unsubscribeLinkInsertSql,
  userIdByEmailSql,
} from './notification-fixture-sql.ts';
import {
  createUnsubscribeSeed,
  deriveUnsubscribeToken,
} from './unsubscribe-link.ts';

export type { SenderInfoSnapshot } from './notification-fixture-sql.ts';

const nextFixtureId = (): string =>
  fixtureId(new Date(), randomBytes(ID_RANDOM_BYTES));

export async function findUserIdByEmail(email: string): Promise<string> {
  return parseUserId(await executeLocalD1(userIdByEmailSql(email)), email);
}

// メールを送らずに配信停止の流れを確かめるため、送信の時と同じ方式(security/010の導出)で種からトークンを作り、受信する設定の行と種の行をローカルのD1へ用意する。ペッパーはE2Eテストのコマンドへ注入されたシークレットを使う
export async function createUnsubscribeToken(
  userId: string,
  topic: NotificationTopic,
): Promise<string> {
  const seed = createUnsubscribeSeed();
  const { token, tokenHash } = deriveUnsubscribeToken({
    pepper: process.env.HASH_PEPPER ?? '',
    userId,
    topic,
    seed,
  });
  const write = {
    userId,
    topic,
    preferenceId: nextFixtureId(),
    tokenRowId: nextFixtureId(),
    seed,
    tokenHash,
    at: new Date(),
  };
  parseUnsubscribeLinkInsert(
    await executeLocalD1(unsubscribeLinkInsertSql(write)),
    write,
  );
  return token;
}

export async function readSenderInfoSnapshot(): Promise<SenderInfoSnapshot> {
  return parseSenderInfoSnapshot(
    await executeLocalD1(SENDER_INFO_SNAPSHOT_SQL),
  );
}

// 共有のローカルのD1に送信者情報が残ると通知メールが送られ始めるため、保存を確かめた後に読んだ時点の行へ戻す
export async function restoreSenderInfo(
  snapshot: SenderInfoSnapshot,
): Promise<void> {
  const restored = await executeLocalD1(senderInfoRestoreSql(snapshot));
  if (restored.length !== 1) {
    throw new Error('ローカルのD1の送信者情報を元の値へ戻せませんでした');
  }
}
