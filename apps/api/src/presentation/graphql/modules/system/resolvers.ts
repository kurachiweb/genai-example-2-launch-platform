import {
  SYSTEM_TYPES,
  type SystemStatusQuery,
} from '../../../../application/system/system-status-query.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';

export const systemResolvers = {
  Query: {
    systemStatus: (_parent, _args, context) =>
      context
        .resolve<SystemStatusQuery>(SYSTEM_TYPES.SystemStatusQuery)
        .execute(),
  },
} satisfies Resolvers;
