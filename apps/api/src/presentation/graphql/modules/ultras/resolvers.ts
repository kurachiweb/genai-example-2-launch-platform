import type { GraphQLResolveInfo } from 'graphql';

import type { PortalSessionStarter } from '../../../../application/ultras/portal-session-starter.ts';
import type { PromotionSettingService } from '../../../../application/ultras/promotion-setting-service.ts';
import type { UltrasCheckout } from '../../../../application/ultras/ultras-checkout.ts';
import type { UltrasPlanReader } from '../../../../application/ultras/ultras-plan-reader.ts';
import { API_ULTRAS_TYPES } from '../../../../application/ultras/ultras-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { adminOnly } from '../admin/resolver-support.ts';
import { callerForbiddenError } from './errors.ts';
import { UPDATE_ULTRAS_PROMOTION_SETTING_ARGS } from './inputs.ts';
import {
  toUltrasOffer,
  toUltrasPromotionSetting,
  toViewerUltras,
} from './mappers.ts';

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// 利用者側の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。ログインの確認より前に拒否する
function clientOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'client') {
      throw callerForbiddenError();
    }
    return resolve(parent, args, context, info);
  };
}

const planReaderOf = (context: GraphQLContext): UltrasPlanReader =>
  context.resolve<UltrasPlanReader>(API_ULTRAS_TYPES.UltrasPlanReader);

const checkoutOf = (context: GraphQLContext): UltrasCheckout =>
  context.resolve<UltrasCheckout>(API_ULTRAS_TYPES.UltrasCheckout);

const portalOf = (context: GraphQLContext): PortalSessionStarter =>
  context.resolve<PortalSessionStarter>(API_ULTRAS_TYPES.PortalSessionStarter);

const promotionSettingOf = (context: GraphQLContext): PromotionSettingService =>
  context.resolve<PromotionSettingService>(
    API_ULTRAS_TYPES.PromotionSettingService,
  );

// ユースケースはGraphQLContextを受け取らないため、解決関数がセッションを取り出して渡す。
// 管理者側の操作は解決関数が認可し、変更には管理者のIDを渡す。照会は全ロール、変更は最上位管理者に限る
export const ultrasResolvers = {
  Query: {
    ultrasOffer: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) =>
        toUltrasOffer(await planReaderOf(context).offer()),
    ),
    viewerUltras: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const view = await planReaderOf(context).viewer(context.session);
        return view === null ? null : toViewerUltras(view);
      },
    ),
    ultrasPromotionSetting: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        return toUltrasPromotionSetting(
          await promotionSettingOf(context).read(),
        );
      },
    ),
  },
  Mutation: {
    startUltrasCheckout: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const { purchaseId } = await checkoutOf(context).start(context.session);
        return { purchaseId };
      },
    ),
    createUltrasPortalSession: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const { url } = await portalOf(context).start(context.session);
        return { url };
      },
    ),
    updateUltrasPromotionSetting: adminOnly(
      withValidatedArgs(
        UPDATE_ULTRAS_PROMOTION_SETTING_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireAdmin(context, 'super_admin');
          return toUltrasPromotionSetting(
            await promotionSettingOf(context).update({
              adminId: current.id,
              ...input,
            }),
          );
        },
      ),
    ),
  },
} satisfies Resolvers;
