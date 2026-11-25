import type { Container } from 'inversify';

import {
  OWN_PRODUCT_PAGE_SIZE,
  type OwnProductDescriptionService,
} from '../../../../application/public-api/own-product-description-service.ts';
import { PUBLIC_API_TYPES } from '../../../../application/public-api/public-api-types.ts';
import type { PublicRestRoutes } from '../../public-api-app.ts';
import { dataEnvelope, errorResponses } from '../../responses.ts';
import {
  toMyProduct,
  toMyProductListPage,
} from '../mappers/my-product-mappers.ts';
import { definePublicApiRoute } from '../route-definition.ts';
import { CursorQuerySchema, publicApiCursorOf } from '../schemas/common.ts';
import {
  MyProductDescriptionBodySchema,
  MyProductListSchema,
  MyProductParamsSchema,
  MyProductSchema,
} from '../schemas/my-products.ts';

const listMyProductsRoute = definePublicApiRoute({
  method: 'get',
  path: '/me/products',
  summary: '自分のプロダクトの一覧',
  description: `APIキーの持ち主が投稿した論理削除されていないプロダクトを、ディレクトリに掲載中でないもの・非公開化中のものも含めて、取り消したローンチを含む最新のローンチ日の新しい順(同じ日はIDの降順)に、不透明なカーソルの方式で1ページ${String(OWN_PRODUCT_PAGE_SIZE)}件ずつ返す。停止中の利用者のキーは403(account_unavailable)になる。`,
  feature: 'productDescriptions',
  access: 'read',
  target: 'own',
  request: { query: CursorQuerySchema },
  responses: {
    200: {
      description: '自分のプロダクトの一覧',
      content: { 'application/json': { schema: MyProductListSchema } },
    },
    ...errorResponses([400]),
  },
});

const updateMyProductDescriptionRoute = definePublicApiRoute({
  method: 'put',
  path: '/me/products/{handle}/description',
  summary: '自分のプロダクトの説明文の更新',
  description:
    'APIキーの持ち主のプロダクトの説明文を、プロダクトの編集画面と同じ規則で検証して置き換え、更新後のプロダクトを返す。掲載中のプロダクトは、プロダクトの編集と同じく検索の索引も更新される。説明文の違反は400(validation_error)、存在しない・論理削除された・他の利用者のプロダクトは区別せずに404(product_not_found)、管理者により非公開化されたプロダクトは409(product_hidden)、停止中の利用者のキーは403(account_unavailable)になる。',
  feature: 'productDescriptions',
  access: 'write',
  target: 'own',
  request: {
    params: MyProductParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': { schema: MyProductDescriptionBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: '更新後のプロダクト',
      content: {
        'application/json': { schema: dataEnvelope(MyProductSchema) },
      },
    },
    ...errorResponses([400, 404, 409, 415]),
  },
});

const serviceOf = (container: Container): OwnProductDescriptionService =>
  container.get<OwnProductDescriptionService>(
    PUBLIC_API_TYPES.OwnProductDescriptionService,
  );

export const publicApiMyProductRoutes: PublicRestRoutes<Env> = (api) => {
  api.openapi(listMyProductsRoute, async (c) => {
    const after = publicApiCursorOf(c.req.valid('query').cursor);
    const page = await serviceOf(c.get('container')).list(
      c.get('publicApiCaller').user,
      { after },
    );
    return c.json(toMyProductListPage(page, c.env.CLIENT_SITE_ORIGIN), 200);
  });

  api.openapi(updateMyProductDescriptionRoute, async (c) => {
    const product = await serviceOf(c.get('container')).update(
      c.get('publicApiCaller').user,
      {
        productHandle: c.req.valid('param').handle,
        descriptionMarkdown: c.req.valid('json').description_markdown,
      },
    );
    return c.json(
      { data: toMyProduct(product, c.env.CLIENT_SITE_ORIGIN) },
      200,
    );
  });
};
