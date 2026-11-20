import type { ImageModerationService } from '../../../../application/moderation/image-moderation-service.ts';
import { MODERATION_TYPES } from '../../../../application/moderation/moderation-types.ts';
import type {
  ModerationCommand,
  ModerationOutcome,
} from '../../../../application/moderation/ports.ts';
import type { QuarantinedImageReader } from '../../../../application/moderation/quarantined-image-reader.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { toAdminQuarantinedImage } from './content-views.ts';
import { toModerationError } from './errors.ts';
import {
  ADMIN_QUARANTINED_IMAGES_ARGS,
  IMAGE_MODERATION_ARGS,
} from './inputs.ts';
import {
  adminOnly,
  clockOf,
  moderationOperatorOf,
} from './resolver-support.ts';

type ImageOperation = Exclude<keyof ImageModerationService, symbol>;

const imageReaderOf = (context: GraphQLContext): QuarantinedImageReader =>
  context.resolve<QuarantinedImageReader>(
    MODERATION_TYPES.QuarantinedImageReader,
  );

const imageModerationOf = (context: GraphQLContext): ImageModerationService =>
  context.resolve<ImageModerationService>(
    MODERATION_TYPES.ImageModerationService,
  );

// 画像用でない用途のファイルに上流が投げるquarantine_not_applicableをimage_not_foundへ変える
const imageModerationResolver = (operation: ImageOperation) =>
  adminOnly(
    withValidatedArgs(
      IMAGE_MODERATION_ARGS,
      async (_parent: unknown, { fileId, reason }, context) => {
        const operator = await moderationOperatorOf(context, 'moderator');
        const command: ModerationCommand = {
          targetId: fileId,
          reason,
          operator,
          at: clockOf(context).now(),
        };
        let outcome: ModerationOutcome;
        try {
          outcome = await imageModerationOf(context)[operation](command);
        } catch (error) {
          throw toModerationError(error);
        }
        return { changed: outcome.changed };
      },
    ),
  );

// 隔離画像の一覧は閲覧のみ以上、画像の措置はモデレーター以上に許す。理由は任意。各リゾルバはadminOnlyで包み、入力の検証より前に管理者側以外の呼び出しを拒否する
export const imageResolvers = {
  Query: {
    adminQuarantinedImages: adminOnly(
      withValidatedArgs(
        ADMIN_QUARANTINED_IMAGES_ARGS,
        async (_parent: unknown, { reason, after }, context) => {
          await moderationOperatorOf(context, 'viewer');
          const page = await imageReaderOf(context).list({
            reason,
            cursor: after,
          });
          return {
            items: page.items.map(toAdminQuarantinedImage),
            nextCursor: page.nextCursor ?? null,
          };
        },
      ),
    ),
  },
  Mutation: {
    approveQuarantinedImage: imageModerationResolver('approve'),
    quarantineImage: imageModerationResolver('quarantine'),
    releaseQuarantinedImage: imageModerationResolver('release'),
    deleteQuarantinedImage: imageModerationResolver('remove'),
  },
} satisfies Resolvers;
