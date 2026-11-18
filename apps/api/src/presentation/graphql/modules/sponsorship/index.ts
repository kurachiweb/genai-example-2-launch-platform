import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { clientResolvers } from './client-resolvers.ts';
import { sponsorshipViewResolvers } from './sponsorship-views.ts';
import { SPONSORSHIP_TYPE_DEFS } from './type-defs.ts';

const sponsorshipResolvers = {
  ...sponsorshipViewResolvers,
  Query: { ...clientResolvers.Query },
  Mutation: { ...clientResolvers.Mutation },
} satisfies Resolvers;

export const sponsorshipSchemaModule = defineSchemaModule({
  name: 'sponsorship',
  typeDefs: SPONSORSHIP_TYPE_DEFS,
  resolvers: sponsorshipResolvers,
});
