import { userFollows } from '../../../../db/schema/follow/user-follows.ts';
import { notificationEvents } from '../../../../db/schema/notifications/notification-events.ts';
import type { NotificationTopic } from '../../../../common-lib/notifications/notification-topics.ts';
import type { NotificationWorkRequester } from '../../../core/notifications/ports.ts';
import { parseBusinessDate } from '../../../core/time/business-time.ts';
import {
  DECIDED_AT,
  STARTS_AT,
} from '../../match/testing/directory-fixtures.ts';
import {
  clearMatchTables,
  type MatchFixture,
} from '../../match/testing/match-fixtures.ts';
import { insertProduct } from '../../product/testing/product-fixtures.ts';
import {
  clearNotificationRows,
  db,
  insertPreference,
  insertPreferences,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from './notification-store-fixtures.ts';

export const MATCH_DAY = parseBusinessDate('2026-11-20');

// 1行が6個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const FOLLOW_ROWS_PER_INSERT = 15;

export interface FlushRequest {
  readonly slotKey: string;
  readonly delaySeconds: number;
}

export interface RecordingWorkRequester extends NotificationWorkRequester {
  readonly flushes: readonly FlushRequest[];
  readonly expansions: readonly string[];
}

export function createRecordingWorkRequester(
  failure?: Error,
): RecordingWorkRequester {
  const flushes: FlushRequest[] = [];
  const expansions: string[] = [];
  return {
    flushes,
    expansions,
    flushSlot: (slotKey, delaySeconds) => {
      flushes.push({ slotKey, delaySeconds });
      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(failure);
    },
    expandEvent: (eventId) => {
      expansions.push(eventId);
      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(failure);
    },
  };
}

const OWNER_TOPICS: Readonly<Record<number, readonly NotificationTopic[]>> =
  Object.freeze({
    1: ['match_preview', 'match_result'],
    2: ['match_result'],
    3: ['match_preview'],
    4: [],
  });

// 利用者1〜4と、同じ番号の利用者のプロダクト1〜4を作る。1は予告と結果、2は結果だけ、3は予告だけを受信し、4は何も受信しない
export async function seedMatchOwners(): Promise<void> {
  await clearNotificationRows();
  await clearMatchTables();
  for (const [owner, topics] of Object.entries(OWNER_TOPICS)) {
    const index = Number(owner);
    await insertUser(index, { emailVerifiedAt: T0 });
    await insertProduct(index, index);
    for (const topic of topics) {
      await insertPreference(index, topic, true);
    }
  }
}

export type MatchState = 'scheduled' | 'live' | 'decided';

const STATE_COLUMNS: Readonly<
  Record<MatchState, NonNullable<MatchFixture['columns']>>
> = Object.freeze({
  scheduled: {},
  live: { startedAt: STARTS_AT },
  decided: { startedAt: STARTS_AT, decidedAt: DECIDED_AT, decision: 'votes' },
});

// 側の番号の順に、同じ番号の利用者のプロダクトを出すWeekトーナメントの1回戦
export function tournamentMatch(
  index: number,
  state: MatchState,
  owners: readonly number[],
  columns: MatchFixture['columns'] = {},
): MatchFixture {
  return {
    index,
    columns: { kind: 'week', round: 1, ...STATE_COLUMNS[state], ...columns },
    entries: owners.map((owner, position) => ({
      index: index * 10 + position + 1,
      launch: null,
      product: owner,
      owner,
      columns:
        state === 'decided' ? { result: position === 0 ? 'won' : 'lost' } : {},
    })),
  };
}

export function awardProductIdOf(index: number): string {
  return `01JC0PRDCT${String(index).padStart(16, '0')}`;
}

export async function insertEventRow(
  columns: typeof notificationEvents.$inferInsert,
): Promise<void> {
  await db.insert(notificationEvents).values(columns);
}

export function followIdOf(followerIndex: number): string {
  return `01JC0FLW${String(followerIndex).padStart(18, '0')}`;
}

export async function clearFollows(): Promise<void> {
  await db.delete(userFollows);
}

// フォローのIDはフォロワーの番号から作るため、番号の昇順がフォロワーの一覧の読み取りの順になる
export async function insertFollowers(
  followeeIndex: number,
  followerIndexes: readonly number[],
): Promise<void> {
  const rows = followerIndexes.map((followerIndex) => ({
    id: followIdOf(followerIndex),
    followerId: userIdOf(followerIndex),
    followeeId: userIdOf(followeeIndex),
    createdAt: T0,
    updatedAt: T0,
  }));
  for (let start = 0; start < rows.length; start += FOLLOW_ROWS_PER_INSERT) {
    await db
      .insert(userFollows)
      .values(rows.slice(start, start + FOLLOW_ROWS_PER_INSERT));
  }
}

// メールアドレスを確認済みで受賞結果を受信する利用者を作り、指定した利用者をフォローさせる
export async function seedAwardFollowers(
  followeeIndex: number,
  followerIndexes: readonly number[],
): Promise<void> {
  await insertUsers(followerIndexes, { emailVerifiedAt: T0 });
  await insertPreferences(followerIndexes, 'followed_user_award', true);
  await insertFollowers(followeeIndex, followerIndexes);
}
