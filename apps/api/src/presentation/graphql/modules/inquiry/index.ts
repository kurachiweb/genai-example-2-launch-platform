import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { adminResolvers } from './admin-resolvers.ts';
import { clientResolvers } from './client-resolvers.ts';
import { INQUIRY_TYPE_DEFS } from './type-defs.ts';

const inquiryResolvers = {
  ...clientResolvers,
  ...adminResolvers,
  Query: { ...clientResolvers.Query, ...adminResolvers.Query },
  Mutation: { ...clientResolvers.Mutation, ...adminResolvers.Mutation },
} satisfies Resolvers;

export const inquirySchemaModule = defineSchemaModule({
  name: 'inquiry',
  typeDefs: INQUIRY_TYPE_DEFS,
  resolvers: inquiryResolvers,
});
