import type { Container } from 'inversify';

import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import type { DirectoryCategoryReader } from '../../../../application/directory/directory-category-reader.ts';
import type { DirectoryReader } from '../../../../application/directory/directory-reader.ts';
import { DIRECTORY_TYPES } from '../../../../application/directory/directory-types.ts';
import type {
  ProductPageReader,
  ProductPageView,
} from '../../../../application/directory/product-page-reader.ts';
import { PUBLIC_API_TYPES } from '../../../../application/public-api/public-api-types.ts';
import type { PublicRestRoutes } from '../../public-api-app.ts';
import {
  dataEnvelope,
  errorResponses,
  offsetListEnvelope,
} from '../../responses.ts';
import {
  mediaRequestOfDirectoryPage,
  mediaRequestOfProductPage,
  toLaunches,
  toProductCategory,
  toProductDetail,
  toProductListPage,
} from '../mappers/product-mappers.ts';
import { publicApiOriginsOf } from '../mappers/common-mappers.ts';
import type { MediaLookup } from '../media-lookup.ts';
import { redirectToCurrentHandle } from '../product-resolution.ts';
import { publicApiError } from '../public-api-errors.ts';
import { definePublicApiRoute } from '../route-definition.ts';
import {
  LaunchSchema,
  PRODUCT_LIST_QUERY_MESSAGES,
  ProductCategorySchema,
  ProductDetailSchema,
  ProductHandleParamsSchema,
  ProductListItemSchema,
  ProductListQuerySchema,
} from '../schemas/products.ts';

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

const REDIRECT_RESPONSE = Object.freeze({
  302: {
    description:
      '保持中の旧ハンドルの指定。Locationは現在のハンドルに置き換えた同じ経路(クエリを保つ)',
  },
});

const PRODUCT_NOT_FOUND_DESCRIPTION =
  '存在しない、掲載中でない、非公開化された、投稿者が退会済みまたは停止中、または論理削除されたプロダクトは、区別せずに404(product_not_found)を返す。キーの持ち主のプロダクトも未ログインの閲覧者と同じ公開範囲で扱う。';

const listProductsRoute = definePublicApiRoute({
  method: 'get',
  path: '/products',
  summary: '掲載中のプロダクトの一覧',
  description:
    'ディレクトリと同じ掲載の条件・キーワード検索・カテゴリと期間の絞り込み・並び順で、掲載中のプロダクトをページ番号の方式で1ページ20件ずつ返す。条件の誤りは項目ごとの入力の誤り(400、validation_error)を返す。',
  feature: 'products',
  access: 'read',
  target: 'public',
  request: { query: ProductListQuerySchema },
  responses: {
    200: {
      description: '掲載中のプロダクトの一覧と総件数',
      content: {
        'application/json': {
          schema: offsetListEnvelope(ProductListItemSchema),
        },
      },
    },
    ...errorResponses([400]),
  },
});

const getProductRoute = definePublicApiRoute({
  method: 'get',
  path: '/products/{handle}',
  summary: '掲載中のプロダクトの詳細',
  description: PRODUCT_NOT_FOUND_DESCRIPTION,
  feature: 'products',
  access: 'read',
  target: 'public',
  request: { params: ProductHandleParamsSchema },
  responses: {
    200: {
      description: 'プロダクトの詳細',
      content: {
        'application/json': { schema: dataEnvelope(ProductDetailSchema) },
      },
    },
    ...REDIRECT_RESPONSE,
    ...errorResponses([404]),
  },
});

const listProductCategoriesRoute = definePublicApiRoute({
  method: 'get',
  path: '/product-categories',
  summary: 'プロダクトカテゴリの一覧',
  description:
    '全てのプロダクトカテゴリを、掲載中のプロダクトの数が多い順(同数は名称順)に、標準のカテゴリ「その他」を末尾にして返す。',
  feature: 'products',
  access: 'read',
  target: 'public',
  responses: {
    200: {
      description: 'プロダクトカテゴリの一覧',
      content: {
        'application/json': {
          schema: dataEnvelope(ProductCategorySchema.array()),
        },
      },
    },
  },
});

const listLaunchesRoute = definePublicApiRoute({
  method: 'get',
  path: '/products/{handle}/launches',
  summary: '掲載中のプロダクトのローンチ履歴',
  description: `取り消されていないローンチをローンチ日の新しい順に、各ローンチの結果が確定したマッチとともに返す。${PRODUCT_NOT_FOUND_DESCRIPTION}`,
  feature: 'launches',
  access: 'read',
  target: 'public',
  request: { params: ProductHandleParamsSchema },
  responses: {
    200: {
      description: 'ローンチ履歴',
      content: {
        'application/json': { schema: dataEnvelope(LaunchSchema.array()) },
      },
    },
    ...REDIRECT_RESPONSE,
    ...errorResponses([404]),
  },
});

type ProductPageOutcome =
  | { readonly kind: 'page'; readonly view: ProductPageView }
  | { readonly kind: 'redirect'; readonly handle: string };

const nowOf = (container: Container): Date =>
  container.get<Clock>(PLATFORM_TYPES.Clock).now();

const mediaLookupOf = (container: Container): MediaLookup =>
  container.get<MediaLookup>(PUBLIC_API_TYPES.MediaLookup);

const categoryNotFoundError = (): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [
      {
        field: 'category',
        code: 'not_found',
        message: PRODUCT_LIST_QUERY_MESSAGES.categoryNotFound,
      },
    ],
  });

// 公開APIはキーの持ち主も閲覧者とせず、未ログインの閲覧者と同じ公開範囲で読む
async function readProductPage(
  container: Container,
  handle: string,
): Promise<ProductPageOutcome> {
  const result = await container
    .get<ProductPageReader>(DIRECTORY_TYPES.ProductPageReader)
    .read({ handle, viewer: undefined, now: nowOf(container) });
  if (result.kind === 'not-found') {
    throw publicApiError('product_not_found');
  }
  return result.kind === 'page'
    ? { kind: 'page', view: result.view }
    : { kind: 'redirect', handle: result.handle };
}

export const publicApiProductRoutes: PublicRestRoutes<Env> = (api) => {
  api.openapi(listProductsRoute, async (c) => {
    const query = c.req.valid('query');
    const container = c.get('container');
    const view = await container
      .get<DirectoryReader>(DIRECTORY_TYPES.DirectoryReader)
      .read({ raw: query, viewer: undefined, now: nowOf(container) });
    // 上流は存在しないカテゴリを黙って絞り込みなしにするため、解決できなかったカテゴリを入力の誤りにする
    if (query.category !== undefined && view.applied.category === undefined) {
      throw categoryNotFoundError();
    }
    const loaded = await mediaLookupOf(container).load(
      mediaRequestOfDirectoryPage(view),
    );
    return c.json(
      toProductListPage(view, loaded, publicApiOriginsOf(c.env)),
      200,
    );
  });

  api.openapi(getProductRoute, async (c) => {
    const container = c.get('container');
    const outcome = await readProductPage(
      container,
      c.req.valid('param').handle,
    );
    if (outcome.kind === 'redirect') {
      return redirectToCurrentHandle(c, outcome.handle);
    }
    const loaded = await mediaLookupOf(container).load(
      mediaRequestOfProductPage(outcome.view),
    );
    return c.json(
      {
        data: toProductDetail(outcome.view, loaded, publicApiOriginsOf(c.env)),
      },
      200,
    );
  });

  api.openapi(listProductCategoriesRoute, async (c) => {
    const categories = await c
      .get('container')
      .get<DirectoryCategoryReader>(DIRECTORY_TYPES.DirectoryCategoryReader)
      .list();
    return c.json({ data: categories.map(toProductCategory) }, 200);
  });

  api.openapi(listLaunchesRoute, async (c) => {
    const outcome = await readProductPage(
      c.get('container'),
      c.req.valid('param').handle,
    );
    if (outcome.kind === 'redirect') {
      return redirectToCurrentHandle(c, outcome.handle);
    }
    return c.json({ data: toLaunches(outcome.view) }, 200);
  });
};
