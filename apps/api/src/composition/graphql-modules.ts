import { adminSchemaModule } from '../presentation/graphql/modules/admin/index.ts';
import { identitySchemaModule } from '../presentation/graphql/modules/identity/index.ts';
import { mediaSchemaModule } from '../presentation/graphql/modules/media/index.ts';
import { systemSchemaModule } from '../presentation/graphql/modules/system/index.ts';
import type { GraphQLSchemaModule } from '../presentation/graphql/schema-module.ts';

export const GRAPHQL_SCHEMA_MODULES: readonly GraphQLSchemaModule[] = [
  systemSchemaModule,
  mediaSchemaModule,
  identitySchemaModule,
  adminSchemaModule,
];
