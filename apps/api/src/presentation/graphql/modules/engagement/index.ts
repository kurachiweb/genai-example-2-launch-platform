import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { commentResolvers } from './comment-resolvers.ts';
import { engagementViewResolvers } from './engagement-views.ts';
import { ENGAGEMENT_TYPE_DEFS } from './type-defs.ts';

const engagementResolvers = {
  ...engagementViewResolvers,
  Query: { ...commentResolvers.Query },
} satisfies Resolvers;

export const engagementSchemaModule = defineSchemaModule({
  name: 'engagement',
  typeDefs: ENGAGEMENT_TYPE_DEFS,
  resolvers: engagementResolvers,
});
