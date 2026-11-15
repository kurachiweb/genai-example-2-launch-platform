import { defineSchemaModule } from '../../schema-module.ts';
import { categoryResolvers } from './category-resolvers.ts';
import { launchHistoryResolvers } from './launch-history-resolvers.ts';
import { myProductResolvers } from './my-product-resolvers.ts';
import { productMutationResolvers } from './product-mutation-resolvers.ts';
import { productViewResolvers } from './product-views.ts';
import { PRODUCT_TYPE_DEFS } from './type-defs.ts';

export const productSchemaModule = defineSchemaModule({
  name: 'product',
  typeDefs: PRODUCT_TYPE_DEFS,
  resolvers: {
    ...productViewResolvers,
    Query: {
      ...myProductResolvers.Query,
      ...launchHistoryResolvers.Query,
      ...categoryResolvers.Query,
    },
    Mutation: {
      ...productMutationResolvers.Mutation,
      ...categoryResolvers.Mutation,
    },
  },
});
