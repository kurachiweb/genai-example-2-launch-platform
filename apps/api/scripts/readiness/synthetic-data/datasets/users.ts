import { users } from '../../../../db/schema/identity/users.ts';
import { notificationPreferences } from '../../../../db/schema/notifications/notification-preferences.ts';
import { userFollows } from '../../../../db/schema/follow/user-follows.ts';
import { userProfiles } from '../../../../db/schema/profile/user-profiles.ts';
import {
  LARGEST_CREATOR_INDEX,
  userAt,
  type EntityContext,
} from '../entities.ts';
import { deterministicUlid } from '../random.ts';
import { assertScaleProfile, type ScaleProfile } from '../scale-profile.ts';
import {
  insertStatements,
  type DatasetContext,
  type DatasetSamples,
  type SqlRow,
  type SqlStatement,
  type SyntheticDataset,
} from '../sql-writer.ts';

const HOUR_MS = 3_600_000;

const SAMPLE_COUNT = 5;

// ログインさせない利用者のため、どのパスワードの検証にも一致しない値にする
const UNUSABLE_PASSWORD_HASH = 'synthetic-unusable';

const FOLLOWED_USER_MATCH_TOPIC = 'followed_user_match';

const entityContextOf = (
  profile: ScaleProfile,
  context: DatasetContext,
): EntityContext => ({
  seed: context.seed,
  baseDate: context.baseDate,
  profile,
});

function* userRows(entities: EntityContext): Generator<SqlRow> {
  for (let index = 0; index < entities.profile.users; index += 1) {
    const user = userAt(entities, index);
    yield {
      id: user.id,
      pseudonymousId: user.pseudonymousId,
      email: user.email,
      passwordHash: UNUSABLE_PASSWORD_HASH,
      nickname: user.nickname,
      handle: user.handle,
      emailVerifiedAt: user.emailVerifiedAt,
      disposableEmailStatus: 'regular',
      disposableEmailCheckedAt: user.emailVerifiedAt,
      termsAgreedAt: user.createdAt,
      createdAt: user.createdAt,
      updatedAt: user.createdAt,
    };
  }
}

function* profileRows(entities: EntityContext): Generator<SqlRow> {
  for (let index = 0; index < entities.profile.users; index += 1) {
    const user = userAt(entities, index);
    yield {
      id: deterministicUlid(
        user.createdAt,
        `${String(entities.seed)}:profile:${String(index)}`,
      ),
      userId: user.id,
      headline: `${user.nickname}の自己紹介`,
      bioMarkdown: `## ${user.nickname}\n\n性能の検証のために自動で作った利用者です。\n\n- 用途: 一覧・検索・公開プロフィールの表示の計測`,
      createdAt: user.createdAt,
      updatedAt: user.createdAt,
    };
  }
}

function* followerIndexes(entities: EntityContext): Generator<number> {
  for (
    let offset = 1;
    offset <= entities.profile.followersOfLargestCreator;
    offset += 1
  ) {
    yield LARGEST_CREATOR_INDEX + offset;
  }
}

// フォローと受信設定の作成は、フォロワーの作成の1時間後にする
const followedAtOf = (entities: EntityContext, index: number): Date =>
  new Date(userAt(entities, index).createdAt.getTime() + HOUR_MS);

function* followRows(entities: EntityContext): Generator<SqlRow> {
  const creator = userAt(entities, LARGEST_CREATOR_INDEX);
  for (const index of followerIndexes(entities)) {
    const followedAt = followedAtOf(entities, index);
    yield {
      id: deterministicUlid(
        followedAt,
        `${String(entities.seed)}:follow:${String(index)}`,
      ),
      followerId: userAt(entities, index).id,
      followeeId: creator.id,
      createdAt: followedAt,
      updatedAt: followedAt,
    };
  }
}

// 受信設定の初期値は受信しない(行が無い)ため、開催通知の収集の対象にするフォロワーの分だけ有効の行を作る
function* preferenceRows(entities: EntityContext): Generator<SqlRow> {
  for (const index of followerIndexes(entities)) {
    const changedAt = followedAtOf(entities, index);
    yield {
      id: deterministicUlid(
        changedAt,
        `${String(entities.seed)}:preference:${String(index)}`,
      ),
      userId: userAt(entities, index).id,
      topic: FOLLOWED_USER_MATCH_TOPIC,
      enabled: true,
      createdAt: changedAt,
      updatedAt: changedAt,
    };
  }
}

function* generate(
  profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  assertScaleProfile(profile);
  const entities = entityContextOf(profile, context);
  yield* insertStatements(users, userRows(entities));
  yield* insertStatements(userProfiles, profileRows(entities));
  yield* insertStatements(userFollows, followRows(entities));
  yield* insertStatements(notificationPreferences, preferenceRows(entities));
}

function samples(
  profile: ScaleProfile,
  context: DatasetContext,
): DatasetSamples {
  const entities = entityContextOf(profile, context);
  return {
    largestCreatorHandle: [userAt(entities, LARGEST_CREATOR_INDEX).handle],
    profileHandles: Array.from(
      { length: Math.min(SAMPLE_COUNT, profile.users) },
      (_, index) => userAt(entities, index).handle,
    ),
  };
}

export const usersDataset: SyntheticDataset = {
  name: 'users',
  dependsOn: [],
  generate,
  samples,
};
