import { ADMIN_PLATFORM_TYPES } from '../../../../../lib/core/admin/identifiers.ts';
import type { AdminDirectory } from '../../../../../lib/core/admin/ports.ts';
import type {
  YearFinalDateService,
  YearFinalDateView,
} from '../../../../application/year-tournament/year-final-date-service.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../../../../application/year-tournament/year-tournament-api-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { adminOnly } from '../admin/resolver-support.ts';
import { UPDATE_YEAR_FINAL_DATE_ARGS } from './inputs.ts';
import { toYearFinalDateSetting } from './mappers.ts';
import { clockOf } from '../tournament/resolver-support.ts';

const INPUT_ARGUMENT = 'input';

const finalDateServiceOf = (context: GraphQLContext): YearFinalDateService =>
  context.resolve<YearFinalDateService>(
    YEAR_TOURNAMENT_API_TYPES.YearFinalDateService,
  );

// 照会口は有効な管理者だけを返すため、削除済み・招待中の管理者のニックネームは含まれない
async function nicknamesOf(
  context: GraphQLContext,
  views: readonly YearFinalDateView[],
): Promise<ReadonlyMap<string, string>> {
  const adminIds = [
    ...new Set(
      views.flatMap(({ updatedByAdminId }) =>
        updatedByAdminId === null ? [] : [updatedByAdminId],
      ),
    ),
  ];
  if (adminIds.length === 0) {
    return new Map();
  }
  const profiles = await context
    .resolve<AdminDirectory>(ADMIN_PLATFORM_TYPES.AdminDirectory)
    .findProfiles(adminIds);
  return new Map(
    [...profiles].map(([adminId, profile]) => [adminId, profile.nickname]),
  );
}

// 照会は全ての管理者、保存は最上位管理者に限る。保存した管理者のIDをユースケースへ渡す
export const finalDateResolvers = {
  Query: {
    yearFinalDateSettings: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        const now = clockOf(context).now();
        const views = await finalDateServiceOf(context).read(now);
        const nicknames = await nicknamesOf(context, views);
        return {
          serverTime: now,
          settings: views.map((view) =>
            toYearFinalDateSetting(view, nicknames),
          ),
        };
      },
    ),
  },
  Mutation: {
    updateYearFinalDate: adminOnly(
      withValidatedArgs(
        UPDATE_YEAR_FINAL_DATE_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireAdmin(context, 'super_admin');
          const view = await withInputPath(INPUT_ARGUMENT, () =>
            finalDateServiceOf(context).update({
              adminId: current.id,
              ...input,
              now: clockOf(context).now(),
            }),
          );
          return toYearFinalDateSetting(
            view,
            await nicknamesOf(context, [view]),
          );
        },
      ),
    ),
  },
} satisfies Resolvers;
