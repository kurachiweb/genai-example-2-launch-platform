import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { settingsResolvers } from './settings-resolvers.ts';
import { NOTIFICATIONS_TYPE_DEFS } from './type-defs.ts';
import { unsubscribeResolvers } from './unsubscribe-resolvers.ts';

const notificationsResolvers = {
  Query: { ...settingsResolvers.Query, ...unsubscribeResolvers.Query },
  Mutation: { ...settingsResolvers.Mutation, ...unsubscribeResolvers.Mutation },
} satisfies Resolvers;

export const notificationsSchemaModule = defineSchemaModule({
  name: 'notifications',
  typeDefs: NOTIFICATIONS_TYPE_DEFS,
  resolvers: notificationsResolvers,
});
