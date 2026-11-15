import type { HandleAvailabilityChecker } from '../../../../application/profile/handle-availability-checker.ts';
import type { MyProfileReader } from '../../../../application/profile/my-profile-reader.ts';
import type { ProfileEditor } from '../../../../application/profile/profile-editor.ts';
import { PROFILE_TYPES } from '../../../../application/profile/profile-types.ts';
import type { PublicProfileReader } from '../../../../application/profile/public-profile-reader.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { INPUT_ARGUMENT } from './errors.ts';
import { HANDLE_AVAILABILITY_ARGS, UPDATE_MY_PROFILE_ARGS } from './inputs.ts';
import {
  handleAvailabilityOf,
  toMyProfile,
  toPublicProfile,
} from './mappers.ts';
import {
  accountGuardOf,
  assertHuman,
  clientOnly,
  PROFILE_BOT_ACTIONS,
} from './resolver-support.ts';
import { avatarOf } from './user-summary.ts';

const publicReaderOf = (context: GraphQLContext): PublicProfileReader =>
  context.resolve<PublicProfileReader>(PROFILE_TYPES.PublicProfileReader);

const myReaderOf = (context: GraphQLContext): MyProfileReader =>
  context.resolve<MyProfileReader>(PROFILE_TYPES.MyProfileReader);

const editorOf = (context: GraphQLContext): ProfileEditor =>
  context.resolve<ProfileEditor>(PROFILE_TYPES.ProfileEditor);

const availabilityCheckerOf = (
  context: GraphQLContext,
): HandleAvailabilityChecker =>
  context.resolve<HandleAvailabilityChecker>(
    PROFILE_TYPES.HandleAvailabilityChecker,
  );

// 保存は入力の検証→利用者の状態の確認→bot判定→ユースケースの順に行い、トークンを使わずに拒否できる要求でトークンを消費させない。メールアドレスの未確認は拒否しない
export const profileResolvers = {
  Query: {
    publicProfile: clientOnly(
      async (_parent: unknown, args: { handle: string }, context) => {
        const result = await publicReaderOf(context).find(
          context.session,
          args.handle,
        );
        switch (result.kind) {
          case 'profile':
            return toPublicProfile(result.profile);
          case 'redirect':
            return { handle: result.handle };
          case 'not-found':
            return null;
        }
      },
    ),
    myProfile: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const current = await accountGuardOf(context).requireUser(
          context.session,
        );
        return toMyProfile(await myReaderOf(context).read(current));
      },
    ),
    handleAvailability: clientOnly(
      withValidatedArgs(
        HANDLE_AVAILABILITY_ARGS,
        async (_parent: unknown, { handle }, context) => {
          const current = await accountGuardOf(context).requireUser(
            context.session,
          );
          return handleAvailabilityOf(
            await availabilityCheckerOf(context).check(current.user.id, handle),
          );
        },
      ),
    ),
  },
  Mutation: {
    updateMyProfile: clientOnly(
      withValidatedArgs(
        UPDATE_MY_PROFILE_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await accountGuardOf(context).requireWritableUser(
            context.session,
          );
          await assertHuman(context, PROFILE_BOT_ACTIONS.update);
          const updated = await withInputPath(INPUT_ARGUMENT, () =>
            editorOf(context).update(current, input),
          );
          return toMyProfile(updated);
        },
      ),
    ),
  },
  PublicProfileResult: {
    __resolveType: (result: object) =>
      'nickname' in result ? 'PublicProfile' : 'PublicProfileRedirect',
  },
  PublicProfile: {
    avatar: (profile, _args, context) => avatarOf(profile, context),
  },
  MyProfile: {
    avatar: (profile, _args, context) => avatarOf(profile, context),
  },
} satisfies Resolvers;
