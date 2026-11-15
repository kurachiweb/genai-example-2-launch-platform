import { defineSchemaModule } from '../../schema-module.ts';
import { paymentsResolvers } from './resolvers.ts';
import { PAYMENTS_TYPE_DEFS } from './type-defs.ts';

export const paymentsSchemaModule = defineSchemaModule({
  name: 'payments',
  typeDefs: PAYMENTS_TYPE_DEFS,
  resolvers: paymentsResolvers,
});
