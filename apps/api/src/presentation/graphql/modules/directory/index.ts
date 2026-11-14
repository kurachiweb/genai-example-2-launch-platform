import { defineSchemaModule } from '../../schema-module.ts';
import { directoryResolvers } from './directory-resolvers.ts';
import { directoryViewResolvers } from './directory-views.ts';
import { liveMatchResolvers } from './live-match-resolvers.ts';
import { productPageResolvers } from './product-page-resolvers.ts';
import { supporterResolvers } from './supporter-resolvers.ts';
import { DIRECTORY_TYPE_DEFS } from './type-defs.ts';

export const directorySchemaModule = defineSchemaModule({
  name: 'directory',
  typeDefs: DIRECTORY_TYPE_DEFS,
  resolvers: {
    ...directoryViewResolvers,
    ProductPageResult: productPageResolvers.ProductPageResult,
    Query: {
      ...directoryResolvers.Query,
      ...productPageResolvers.Query,
      ...liveMatchResolvers.Query,
      ...supporterResolvers.Query,
    },
  },
});
