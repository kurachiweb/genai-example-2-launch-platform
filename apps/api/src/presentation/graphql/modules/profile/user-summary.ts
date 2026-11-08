import { PROFILE_PLATFORM_TYPES } from '../../../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../../../lib/core/profile/ports.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { defineLoader } from '../../loaders.ts';
import { mediaFileLoader } from '../media/loaders.ts';
import { type MediaImageModel, toMediaImage } from '../media/mappers.ts';

// 後続specは、自分の型の項目でこの形を満たす値(userSummaryLoaderの結果など)を返す
export type UserSummarySource = Pick<
  UserSummaryRecord,
  'avatarFileId' | 'handle' | 'nickname'
>;

// 停止中・退会済み・不在の利用者は表示できないため、キーの位置にnullを置く
export const userSummaryLoader = defineLoader<string, UserSummaryRecord | null>(
  {
    name: 'userSummary',
    batch: async (ids, scope) => {
      const summaries = await scope
        .resolve<UserProfileDirectory>(
          PROFILE_PLATFORM_TYPES.UserProfileDirectory,
        )
        .findSummaries(ids, 'visible');
      return ids.map((id) => summaries.get(id) ?? null);
    },
  },
);

// 一覧の各行で要求されるため、画像の記録は一括読み込みで1回の照会にまとめる
export async function avatarOf(
  parent: Pick<UserSummarySource, 'avatarFileId'>,
  context: GraphQLContext,
): Promise<MediaImageModel | null> {
  if (parent.avatarFileId === null) {
    return null;
  }
  const file = await context.loaders
    .get(mediaFileLoader)
    .load(parent.avatarFileId);
  return file === null ? null : toMediaImage(file);
}

export const userSummaryResolvers = {
  UserSummary: {
    avatar: (summary, _args, context) => avatarOf(summary, context),
  },
} satisfies Resolvers;
