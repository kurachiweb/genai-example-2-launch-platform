import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { caseResolvers } from './case-resolvers.ts';
import { categoryResolvers } from './category-resolvers.ts';
import { submissionResolvers } from './submission-resolvers.ts';
import { summaryResolvers } from './summary-resolvers.ts';
import { REPORTING_TYPE_DEFS } from './type-defs.ts';

// 型の項目のリゾルバも各ファイルに置けるよう、ルート型の他も展開する
const reportingResolvers = {
  ...submissionResolvers,
  ...caseResolvers,
  ...categoryResolvers,
  ...summaryResolvers,
  Query: {
    ...submissionResolvers.Query,
    ...caseResolvers.Query,
    ...categoryResolvers.Query,
    ...summaryResolvers.Query,
  },
  Mutation: {
    ...submissionResolvers.Mutation,
    ...caseResolvers.Mutation,
    ...categoryResolvers.Mutation,
    ...summaryResolvers.Mutation,
  },
} satisfies Resolvers;

export const reportingSchemaModule = defineSchemaModule({
  name: 'reporting',
  typeDefs: REPORTING_TYPE_DEFS,
  resolvers: reportingResolvers,
});
