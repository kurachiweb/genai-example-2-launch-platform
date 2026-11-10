import type { DirectoryCategoryReader } from '../../../../application/directory/directory-category-reader.ts';
import type { DirectoryReader } from '../../../../application/directory/directory-reader.ts';
import { DIRECTORY_TYPES } from '../../../../application/directory/directory-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { toProductCategory } from '../product/mappers.ts';
import { toDirectoryPage } from './mappers.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

// ログインを求めない。入力は検証の違反をエラーにせず、ユースケースが既定の値へ戻した条件を返す
export const directoryResolvers = {
  Query: {
    directory: clientOnly(
      async (_parent: unknown, { input }, context: GraphQLContext) => {
        const viewer = await accountGuardOf(context).currentUser(
          context.session,
        );
        const page = await context
          .resolve<DirectoryReader>(DIRECTORY_TYPES.DirectoryReader)
          .read({ raw: input, viewer, now: clockOf(context).now() });
        return toDirectoryPage(page);
      },
    ),
    directoryCategories: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const categories = await context
          .resolve<DirectoryCategoryReader>(
            DIRECTORY_TYPES.DirectoryCategoryReader,
          )
          .list();
        return categories.map(toProductCategory);
      },
    ),
  },
} satisfies Resolvers;
