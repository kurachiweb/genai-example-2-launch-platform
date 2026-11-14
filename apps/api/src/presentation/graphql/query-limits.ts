import { EnvelopArmorPlugin } from '@escape.tech/graphql-armor';
import type { GraphQLError } from 'graphql';
import type { Plugin } from 'graphql-yoga';

import { type QueryLimitKind, recordLimitRejection } from './error-codes.ts';

export const QUERY_LIMITS = Object.freeze({
  maxDepth: 8,
  maxCost: 5000,
  objectCost: 2,
  scalarCost: 1,
  depthCostFactor: 1.5,
  maxAliases: 15,
  maxTokens: 1000,
  maxDirectives: 50,
} as const);

export interface QueryLimitPluginOptions {
  readonly exposeLimits: boolean;
  readonly blockFieldSuggestion: boolean;
}

// Armorの拒否のエラーは上限の種類を問わず同じ文言になるため、拒否した保護ごとに種類を記録する
function rejectionRecorder(kind: QueryLimitKind) {
  return {
    onReject: [
      (_context: unknown, error: GraphQLError) => {
        recordLimitRejection(error, kind);
      },
    ],
  };
}

export function createQueryLimitPlugins(
  options: QueryLimitPluginOptions,
): readonly Plugin[] {
  const { exposeLimits } = options;
  return [
    EnvelopArmorPlugin({
      maxDepth: {
        n: QUERY_LIMITS.maxDepth,
        exposeLimits,
        ...rejectionRecorder('depth'),
      },
      costLimit: {
        maxCost: QUERY_LIMITS.maxCost,
        objectCost: QUERY_LIMITS.objectCost,
        scalarCost: QUERY_LIMITS.scalarCost,
        depthCostFactor: QUERY_LIMITS.depthCostFactor,
        exposeLimits,
        ...rejectionRecorder('cost'),
      },
      maxAliases: {
        n: QUERY_LIMITS.maxAliases,
        exposeLimits,
        ...rejectionRecorder('aliases'),
      },
      maxTokens: {
        n: QUERY_LIMITS.maxTokens,
        exposeLimits,
        ...rejectionRecorder('tokens'),
      },
      maxDirectives: {
        n: QUERY_LIMITS.maxDirectives,
        exposeLimits,
        ...rejectionRecorder('directives'),
      },
      blockFieldSuggestion: { enabled: options.blockFieldSuggestion },
    }),
  ];
}
