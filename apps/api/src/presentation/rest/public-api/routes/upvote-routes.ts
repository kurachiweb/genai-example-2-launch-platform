import type { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import { decodeCursor } from '../../../../../lib/core/pagination/opaque-cursor.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import { SupporterListPositionSchema } from '../../../../application/directory/supporter-list-reader.ts';
import { MATCH_TYPES } from '../../../../application/match/match-types.ts';
import {
  UPVOTE_HISTORY_PAGE_MAX,
  type UpvoteHistoryReader,
} from '../../../../application/match/upvote-history-reader.ts';
import {
  PUBLIC_SUPPORTER_PAGE_SIZE,
  type PublicSupporterReader,
} from '../../../../application/public-api/public-supporter-reader.ts';
import { PUBLIC_API_TYPES } from '../../../../application/public-api/public-api-types.ts';
import type { PublicRestRoutes } from '../../public-api-app.ts';
import { errorResponses } from '../../responses.ts';
import { publicApiOriginsOf } from '../mappers/common-mappers.ts';
import {
  mediaRequestOfSupporters,
  mediaRequestOfUpvoteHistory,
  toSupporterListPage,
  toUpvoteHistoryListPage,
} from '../mappers/upvote-mappers.ts';
import type { MediaLookup } from '../media-lookup.ts';
import { redirectToCurrentHandle } from '../product-resolution.ts';
import { publicApiError } from '../public-api-errors.ts';
import { definePublicApiRoute } from '../route-definition.ts';
import { CursorQuerySchema, publicApiCursorOf } from '../schemas/common.ts';
import {
  SupporterListSchema,
  SupporterParamsSchema,
  UpvoteHistoryListSchema,
  UserHandleParamsSchema,
} from '../schemas/upvotes.ts';

// 画面のUpvote履歴の1ページと同じ件数
const UPVOTE_HISTORY_PAGE_SIZE = UPVOTE_HISTORY_PAGE_MAX;

const listSupportersRoute = definePublicApiRoute({
  method: 'get',
  path: '/products/{handle}/matches/{match_id}/supporters',
  summary: 'マッチでプロダクトの側にUpvoteした利用者の一覧',
  description: `掲載中のプロダクトの結果が確定したマッチについて、そのプロダクトの側にUpvoteした利用者の表示情報とUpvoteの日時を、Upvoteの日時の早い順に不透明なカーソルの方式で1ページ${String(PUBLIC_SUPPORTER_PAGE_SIZE)}件ずつ返す。退会済み・停止中の利用者は含めない。読み取りの後に表示できなくなった利用者を除くため、1ページが${String(PUBLIC_SUPPORTER_PAGE_SIZE)}件に満たなくてもmeta.has_nextが真のことがある。存在しない・掲載中でない・非公開化された・投稿者が退会済みまたは停止中・論理削除されたプロダクトは区別せずに404(product_not_found)、存在しない・そのプロダクトのマッチでない・結果が確定していないマッチは404(match_not_found)を返す。`,
  feature: 'upvotes',
  access: 'read',
  target: 'public',
  request: { params: SupporterParamsSchema, query: CursorQuerySchema },
  responses: {
    200: {
      description: 'サポーターの一覧',
      content: { 'application/json': { schema: SupporterListSchema } },
    },
    302: {
      description:
        '保持中の旧ハンドルの指定。Locationは現在のハンドルに置き換えた同じ経路(クエリを保つ)',
    },
    ...errorResponses([400, 404]),
  },
});

const listUpvoteHistoryRoute = definePublicApiRoute({
  method: 'get',
  path: '/users/{handle}/upvotes',
  summary: '利用者のUpvote履歴',
  description: `利用者の公開プロフィールと同じ条件のUpvote履歴を、マッチの実施日とUpvoteの日時の新しい順に、不透明なカーソルの方式で1ページ最大${String(UPVOTE_HISTORY_PAGE_SIZE)}件ずつ総件数とともに返す。非公開化・論理削除されたプロダクトと、投稿者が退会済みまたは停止中のプロダクトへのUpvoteは含めない。読み取りの後に表示できなくなった項目を除くため、1ページが${String(UPVOTE_HISTORY_PAGE_SIZE)}件に満たなくてもmeta.has_nextが真のことがある。旧ハンドルは転送せず、その利用者の履歴を返す。存在しない・退会済み・停止中の利用者は区別せずに404(user_not_found)を返す。`,
  feature: 'upvotes',
  access: 'read',
  target: 'public',
  request: { params: UserHandleParamsSchema, query: CursorQuerySchema },
  responses: {
    200: {
      description: 'Upvote履歴と総件数',
      content: { 'application/json': { schema: UpvoteHistoryListSchema } },
    },
    ...errorResponses([400, 404]),
  },
});

const nowOf = (container: Container): Date =>
  container.get<Clock>(PLATFORM_TYPES.Clock).now();

const mediaLookupOf = (container: Container): MediaLookup =>
  container.get<MediaLookup>(PUBLIC_API_TYPES.MediaLookup);

// 公開APIはキーの持ち主も閲覧者とせず、未ログインの閲覧者と同じ公開範囲で読む
export const publicApiUpvoteRoutes: PublicRestRoutes<Env> = (api) => {
  api.openapi(listSupportersRoute, async (c) => {
    const cursor = publicApiCursorOf(c.req.valid('query').cursor);
    const after =
      cursor === undefined
        ? undefined
        : decodeCursor(SupporterListPositionSchema, cursor);
    const params = c.req.valid('param');
    const container = c.get('container');
    const result = await container
      .get<PublicSupporterReader>(PUBLIC_API_TYPES.PublicSupporterReader)
      .list({
        productHandle: params.handle,
        matchId: params.match_id,
        after,
        now: nowOf(container),
      });
    switch (result.kind) {
      case 'redirect': {
        return redirectToCurrentHandle(c, result.handle);
      }
      case 'product-not-found': {
        throw publicApiError('product_not_found');
      }
      case 'match-not-found': {
        throw publicApiError('match_not_found');
      }
      case 'page': {
        const loaded = await mediaLookupOf(container).load(
          mediaRequestOfSupporters(result),
        );
        return c.json(
          toSupporterListPage(result, loaded, publicApiOriginsOf(c.env)),
          200,
        );
      }
    }
  });

  api.openapi(listUpvoteHistoryRoute, async (c) => {
    const after = publicApiCursorOf(c.req.valid('query').cursor);
    const container = c.get('container');
    const page = await container
      .get<UpvoteHistoryReader>(MATCH_TYPES.UpvoteHistoryReader)
      .read({
        userHandle: c.req.valid('param').handle,
        viewer: undefined,
        first: UPVOTE_HISTORY_PAGE_SIZE,
        after,
        now: nowOf(container),
      });
    if (page === null) {
      throw publicApiError('user_not_found');
    }
    const loaded = await mediaLookupOf(container).load(
      mediaRequestOfUpvoteHistory(page),
    );
    return c.json(
      toUpvoteHistoryListPage(page, loaded, publicApiOriginsOf(c.env)),
      200,
    );
  });
};
