import { defineSchemaModule } from '../../schema-module.ts';
import { MEDIA_TYPE_DEFS } from './type-defs.ts';

export const mediaSchemaModule = defineSchemaModule({
  name: 'media',
  typeDefs: MEDIA_TYPE_DEFS,
});
