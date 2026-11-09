import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { mediaFileLoader } from '../media/loaders.ts';
import { type MediaImageModel, toMediaImage } from '../media/mappers.ts';

// 一覧の各行で要求されるため、画像の記録は一括読み込みで1回の照会にまとめる。記録が無い画像はnullにする
export async function productImageOf(
  fileId: string,
  context: GraphQLContext,
): Promise<MediaImageModel | null> {
  const file = await context.loaders.get(mediaFileLoader).load(fileId);
  return file === null ? null : toMediaImage(file);
}

export const productViewResolvers = {
  MyProduct: {
    logo: (product, _args, context) =>
      productImageOf(product.logoFileId, context),
  },
  ProductScreenshot: {
    image: (screenshot, _args, context) =>
      productImageOf(screenshot.fileId, context),
  },
  MyProductResult: {
    __resolveType: (result: object) =>
      'plan' in result ? 'MyProduct' : 'MyProductRedirect',
  },
} satisfies Resolvers;
