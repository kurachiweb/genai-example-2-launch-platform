import { systemSchemaModule } from '../presentation/graphql/modules/system/index.ts';
import type { GraphQLSchemaModule } from '../presentation/graphql/schema-module.ts';

export const GRAPHQL_SCHEMA_MODULES: readonly GraphQLSchemaModule[] = [
  systemSchemaModule,
];
