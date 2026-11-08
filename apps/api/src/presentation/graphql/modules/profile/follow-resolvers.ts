import type { FollowListReader } from '../../../../application/profile/follow-list-reader.ts';
import type { FollowService } from '../../../../application/profile/follow-service.ts';
import type {
  FollowDirection,
  FollowEntryView,
} from '../../../../application/profile/ports.ts';
import { PROFILE_TYPES } from '../../../../application/profile/profile-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { encodeCursor, toConnection } from '../../pagination.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { FOLLOW_LIST_ARGS, followListPositionOf } from './follow-inputs.ts';
import {
  accountGuardOf,
  assertHuman,
  clientOnly,
  PROFILE_BOT_ACTIONS,
} from './resolver-support.ts';

const serviceOf = (context: GraphQLContext): FollowService =>
  context.resolve<FollowService>(PROFILE_TYPES.FollowService);

const listReaderOf = (context: GraphQLContext): FollowListReader =>
  context.resolve<FollowListReader>(PROFILE_TYPES.FollowListReader);

const toFollowEntryConnection = (
  rows: readonly FollowEntryView[],
  first: number,
) => {
  const connection = toConnection(rows, first, (row) =>
    encodeCursor({ t: row.followedAt.getTime(), id: row.followId }),
  );
  return {
    pageInfo: connection.pageInfo,
    nodes: connection.nodes.map((row) => ({
      user: row.user,
      followedAt: row.followedAt,
    })),
  };
};

// 一覧は対象がセッションの本人だけで、停止中でも表示する。位置は利用者の確認の後に戻し、壊れた位置はinvalid_cursorで拒否する
const followListResolver = (direction: FollowDirection) =>
  clientOnly(
    withValidatedArgs(
      FOLLOW_LIST_ARGS,
      async (_parent: unknown, { first, after }, context) => {
        const current = await accountGuardOf(context).requireUser(
          context.session,
        );
        const rows = await listReaderOf(context).list(current, {
          direction,
          first,
          after: followListPositionOf(after),
        });
        return toFollowEntryConnection(rows, first);
      },
    ),
  );

// フォローはメールアドレスの確認済み、解除は書き込み可能な利用者に限る。どちらもbot判定は状態の確認の後に行い、拒否できる要求でトークンを消費させない
export const followResolvers = {
  Query: {
    myFollowing: followListResolver('following'),
    myFollowers: followListResolver('followers'),
  },
  Mutation: {
    followUser: clientOnly(
      async (_parent: unknown, { handle }: { handle: string }, context) => {
        const current = await accountGuardOf(context).requireVerifiedUser(
          context.session,
        );
        await assertHuman(context, PROFILE_BOT_ACTIONS.follow);
        return serviceOf(context).follow(current, handle);
      },
    ),
    unfollowUser: clientOnly(
      async (_parent: unknown, { handle }: { handle: string }, context) => {
        const current = await accountGuardOf(context).requireWritableUser(
          context.session,
        );
        await assertHuman(context, PROFILE_BOT_ACTIONS.follow);
        return serviceOf(context).unfollow(current, handle);
      },
    ),
  },
} satisfies Resolvers;
