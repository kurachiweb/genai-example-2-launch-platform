import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { engagementResolvers } from './engagement-resolvers.ts';
import { imageResolvers } from './image-resolvers.ts';
import { productResolvers } from './product-resolvers.ts';
import { statisticsResolvers } from './statistics-resolvers.ts';
import { MODERATION_TYPE_DEFS } from './type-defs.ts';
import { userResolvers } from './user-resolvers.ts';

const moderationResolvers = {
  Query: {
    ...statisticsResolvers.Query,
    ...userResolvers.Query,
    ...productResolvers.Query,
    ...engagementResolvers.Query,
    ...imageResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...productResolvers.Mutation,
    ...engagementResolvers.Mutation,
    ...imageResolvers.Mutation,
  },
} satisfies Resolvers;

export const moderationSchemaModule = defineSchemaModule({
  name: 'moderation',
  typeDefs: MODERATION_TYPE_DEFS,
  resolvers: moderationResolvers,
});
