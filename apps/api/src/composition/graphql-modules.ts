import { adminSchemaModule } from '../presentation/graphql/modules/admin/index.ts';
import { directorySchemaModule } from '../presentation/graphql/modules/directory/index.ts';
import { helpSchemaModule } from '../presentation/graphql/modules/help/index.ts';
import { identitySchemaModule } from '../presentation/graphql/modules/identity/index.ts';
import { inquirySchemaModule } from '../presentation/graphql/modules/inquiry/index.ts';
import { legalSchemaModule } from '../presentation/graphql/modules/legal/index.ts';
import { matchSchemaModule } from '../presentation/graphql/modules/match/index.ts';
import { mediaSchemaModule } from '../presentation/graphql/modules/media/index.ts';
import { paymentsSchemaModule } from '../presentation/graphql/modules/payments/index.ts';
import { productSchemaModule } from '../presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../presentation/graphql/modules/profile/index.ts';
import { systemSchemaModule } from '../presentation/graphql/modules/system/index.ts';
import { ultrasSchemaModule } from '../presentation/graphql/modules/ultras/index.ts';
import type { GraphQLSchemaModule } from '../presentation/graphql/schema-module.ts';

export const GRAPHQL_SCHEMA_MODULES: readonly GraphQLSchemaModule[] = [
  systemSchemaModule,
  mediaSchemaModule,
  identitySchemaModule,
  adminSchemaModule,
  legalSchemaModule,
  inquirySchemaModule,
  helpSchemaModule,
  paymentsSchemaModule,
  ultrasSchemaModule,
  profileSchemaModule,
  productSchemaModule,
  matchSchemaModule,
  directorySchemaModule,
];
