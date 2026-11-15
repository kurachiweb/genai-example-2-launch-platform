import { DIRECTORY_TYPES } from '../../../../application/directory/directory-types.ts';
import type { ProductPageReader } from '../../../../application/directory/product-page-reader.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import { toProductPage } from './product-page-mappers.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

// ログインを求めない。存在しない・閲覧できないは理由を区別せずnullにし、表示できる旧ハンドルだけ転送先を返す
export const productPageResolvers = {
  Query: {
    productPage: clientOnly(
      async (_parent: unknown, args: { handle: string }, context) => {
        const viewer = await accountGuardOf(context).currentUser(
          context.session,
        );
        const result = await context
          .resolve<ProductPageReader>(DIRECTORY_TYPES.ProductPageReader)
          .read({ handle: args.handle, viewer, now: clockOf(context).now() });
        switch (result.kind) {
          case 'page':
            return toProductPage(result.view);
          case 'redirect':
            return { handle: result.handle };
          case 'not-found':
            return null;
        }
      },
    ),
  },
  ProductPageResult: {
    __resolveType: (result: object) =>
      'launches' in result ? 'ProductPage' : 'ProductPageRedirect',
  },
} satisfies Resolvers;
