import { defineSchemaModule } from '../../schema-module.ts';
import { profileResolvers } from './profile-resolvers.ts';
import { PROFILE_TYPE_DEFS } from './type-defs.ts';
import { userSummaryResolvers } from './user-summary.ts';

export const profileSchemaModule = defineSchemaModule({
  name: 'profile',
  typeDefs: PROFILE_TYPE_DEFS,
  resolvers: {
    ...userSummaryResolvers,
    ...profileResolvers,
  },
});
