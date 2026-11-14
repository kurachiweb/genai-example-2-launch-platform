import { defineSchemaModule } from '../../schema-module.ts';
import { followResolvers } from './follow-resolvers.ts';
import { profileResolvers } from './profile-resolvers.ts';
import { PROFILE_TYPE_DEFS } from './type-defs.ts';
import { userSummaryResolvers } from './user-summary.ts';

export const profileSchemaModule = defineSchemaModule({
  name: 'profile',
  typeDefs: PROFILE_TYPE_DEFS,
  resolvers: {
    ...userSummaryResolvers,
    ...profileResolvers,
    Query: { ...profileResolvers.Query, ...followResolvers.Query },
    Mutation: { ...profileResolvers.Mutation, ...followResolvers.Mutation },
  },
});
