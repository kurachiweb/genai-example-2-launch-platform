import { defineSchemaModule } from '../../schema-module.ts';
import { directoryResolvers } from './directory-resolvers.ts';
import { directoryViewResolvers } from './directory-views.ts';
import { DIRECTORY_TYPE_DEFS } from './type-defs.ts';

export const directorySchemaModule = defineSchemaModule({
  name: 'directory',
  typeDefs: DIRECTORY_TYPE_DEFS,
  resolvers: {
    ...directoryViewResolvers,
    Query: { ...directoryResolvers.Query },
  },
});
