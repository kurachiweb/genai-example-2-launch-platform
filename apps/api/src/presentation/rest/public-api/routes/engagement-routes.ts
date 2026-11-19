import type { Container } from 'inversify';

import { COMMENT_PAGE_SIZE } from '../../../../../common-lib/engagement/engagement-rules.ts';
import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../../../lib/core/product/ports.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import type { CommentReader } from '../../../../application/engagement/comment-reader.ts';
import { ENGAGEMENT_TYPES } from '../../../../application/engagement/engagement-types.ts';
import type { RatingService } from '../../../../application/engagement/rating-service.ts';
import { PUBLIC_API_TYPES } from '../../../../application/public-api/public-api-types.ts';
import type { PublicRestRoutes } from '../../public-api-app.ts';
import { dataEnvelope, errorResponses } from '../../responses.ts';
import { publicApiOriginsOf } from '../mappers/common-mappers.ts';
import {
  mediaRequestOfCommentPage,
  toCommentListPage,
  toRatingSummary,
} from '../mappers/engagement-mappers.ts';
import type { MediaLookup } from '../media-lookup.ts';
import {
  type PublicProductResolution,
  redirectToCurrentHandle,
  resolvePublicProduct,
} from '../product-resolution.ts';
import { publicApiError } from '../public-api-errors.ts';
import { definePublicApiRoute } from '../route-definition.ts';
import { CursorQuerySchema, publicApiCursorOf } from '../schemas/common.ts';
import {
  CommentListSchema,
  LaunchCommentParamsSchema,
  RatingSummarySchema,
} from '../schemas/engagement.ts';
import { ProductHandleParamsSchema } from '../schemas/products.ts';

const REDIRECT_RESPONSE = Object.freeze({
  302: {
    description:
      '保持中の旧ハンドルの指定。Locationは現在のハンドルに置き換えた同じ経路(クエリを保つ)',
  },
});

const PRODUCT_NOT_FOUND_DESCRIPTION =
  '存在しない、掲載中でない、非公開化された、投稿者が退会済みまたは停止中、または論理削除されたプロダクトは、区別せずに404(product_not_found)を返す。';

const listLaunchCommentsRoute = definePublicApiRoute({
  method: 'get',
  path: '/products/{handle}/launches/{launch_id}/comments',
  summary: '掲載中のプロダクトのローンチへのコメント',
  description: `ローンチへのコメントを、トップレベルの投稿の新しい順に不透明なカーソルの方式で1ページ${String(COMMENT_PAGE_SIZE)}スレッドずつ、各スレッドの返信を投稿の古い順に添えて返す。削除・非公開化されたコメントと、退会済み・停止中の利用者のコメントは、本文と投稿者を含めない置き換え表示(removedが真)で返す。${PRODUCT_NOT_FOUND_DESCRIPTION}存在しない・取り消された・そのプロダクトのものでないローンチは404(launch_not_found)を返す。`,
  feature: 'comments',
  access: 'read',
  target: 'public',
  request: { params: LaunchCommentParamsSchema, query: CursorQuerySchema },
  responses: {
    200: {
      description: 'コメントのスレッドの一覧',
      content: { 'application/json': { schema: CommentListSchema } },
    },
    ...REDIRECT_RESPONSE,
    ...errorResponses([400, 404]),
  },
});

const getRatingSummaryRoute = definePublicApiRoute({
  method: 'get',
  path: '/products/{handle}/rating-summary',
  summary: '掲載中のプロダクトの評価の集計',
  description: `5段階評価の平均値と件数を返す。管理者により無効化された評価と、退会済み・停止中の利用者の評価は含めない。${PRODUCT_NOT_FOUND_DESCRIPTION}`,
  feature: 'ratings',
  access: 'read',
  target: 'public',
  request: { params: ProductHandleParamsSchema },
  responses: {
    200: {
      description: '評価の集計',
      content: {
        'application/json': { schema: dataEnvelope(RatingSummarySchema) },
      },
    },
    ...REDIRECT_RESPONSE,
    ...errorResponses([404]),
  },
});

const nowOf = (container: Container): Date =>
  container.get<Clock>(PLATFORM_TYPES.Clock).now();

const mediaLookupOf = (container: Container): MediaLookup =>
  container.get<MediaLookup>(PUBLIC_API_TYPES.MediaLookup);

type ViewableProduct = Exclude<
  PublicProductResolution,
  { readonly kind: 'not-found' }
>;

// 上流の読み取りのnullはプロダクトを表示できない場合も含むため、先にプロダクトを解決してローンチの不在と区別する
async function resolveViewableProduct(
  container: Container,
  handle: string,
): Promise<ViewableProduct> {
  const resolution = await resolvePublicProduct(
    container.get<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory),
    handle,
  );
  if (resolution.kind === 'not-found') {
    throw publicApiError('product_not_found');
  }
  return resolution;
}

// 公開APIはキーの持ち主も閲覧者とせず、未ログインの閲覧者と同じ公開範囲で読む
export const publicApiEngagementRoutes: PublicRestRoutes<Env> = (api) => {
  api.openapi(listLaunchCommentsRoute, async (c) => {
    const after = publicApiCursorOf(c.req.valid('query').cursor);
    const params = c.req.valid('param');
    const container = c.get('container');
    const resolution = await resolveViewableProduct(container, params.handle);
    if (resolution.kind === 'redirect') {
      return redirectToCurrentHandle(c, resolution.handle);
    }
    const page = await container
      .get<CommentReader>(ENGAGEMENT_TYPES.CommentReader)
      .page({
        productId: resolution.product.productId,
        launchId: params.launch_id,
        viewer: undefined,
        after,
        now: nowOf(container),
      });
    if (page === null) {
      throw publicApiError('launch_not_found');
    }
    const loaded = await mediaLookupOf(container).load(
      mediaRequestOfCommentPage(page),
    );
    return c.json(
      toCommentListPage(page, loaded, publicApiOriginsOf(c.env)),
      200,
    );
  });

  api.openapi(getRatingSummaryRoute, async (c) => {
    const container = c.get('container');
    const resolution = await resolveViewableProduct(
      container,
      c.req.valid('param').handle,
    );
    if (resolution.kind === 'redirect') {
      return redirectToCurrentHandle(c, resolution.handle);
    }
    const view = await container
      .get<RatingService>(ENGAGEMENT_TYPES.RatingService)
      .read({
        productId: resolution.product.productId,
        viewer: undefined,
        now: nowOf(container),
      });
    // 解決と読み取りの間に表示できなくなった場合
    if (view === null) {
      throw publicApiError('product_not_found');
    }
    return c.json({ data: toRatingSummary(view) }, 200);
  });
};
