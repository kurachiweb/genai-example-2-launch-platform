import type { GraphQLResolveInfo } from 'graphql';
import type { z } from 'zod';

import {
  AppError,
  type FieldErrorDetail,
} from '../../../lib/core/errors/app-error.ts';
import type { GraphQLContext } from './graphql-context.ts';

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

export type ValidatedResolver<TParent, TResult> = (
  parent: TParent,
  args: unknown,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => Promise<TResult>;

function toFieldErrorDetails(
  issues: readonly z.core.$ZodIssue[],
): FieldErrorDetail[] {
  return issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

export function withValidatedArgs<TSchema extends z.ZodType, TParent, TResult>(
  schema: TSchema,
  resolve: (
    parent: TParent,
    args: z.output<TSchema>,
    context: GraphQLContext,
    info: GraphQLResolveInfo,
  ) => Promise<TResult> | TResult,
): ValidatedResolver<TParent, TResult> {
  return async (parent, args, context, info) => {
    const result = await schema.safeParseAsync(args);
    if (!result.success) {
      throw new AppError({
        kind: 'bad_request',
        code: 'validation_error',
        message: VALIDATION_ERROR_MESSAGE,
        details: toFieldErrorDetails(result.error.issues),
      });
    }
    return resolve(parent, result.data, context, info);
  };
}
