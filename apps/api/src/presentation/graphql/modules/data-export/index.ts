import { defineSchemaModule } from '../../schema-module.ts';
import { dataExportResolvers } from './resolvers.ts';
import { DATA_EXPORT_TYPE_DEFS } from './type-defs.ts';

export const dataExportSchemaModule = defineSchemaModule({
  name: 'data-export',
  typeDefs: DATA_EXPORT_TYPE_DEFS,
  resolvers: dataExportResolvers,
});
