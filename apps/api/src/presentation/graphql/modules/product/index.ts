import { defineSchemaModule } from '../../schema-module.ts';
import { myProductResolvers } from './my-product-resolvers.ts';
import { productViewResolvers } from './product-views.ts';
import { PRODUCT_TYPE_DEFS } from './type-defs.ts';

export const productSchemaModule = defineSchemaModule({
  name: 'product',
  typeDefs: PRODUCT_TYPE_DEFS,
  resolvers: {
    ...productViewResolvers,
    Query: { ...myProductResolvers.Query },
  },
});
