import {
  AppError,
  type FieldErrorDetail,
} from '../../../lib/core/errors/app-error.ts';

function withPrefixedFields(error: AppError, prefix: string): AppError {
  const details = error.details?.map((detail): FieldErrorDetail => ({
    ...detail,
    field: `${prefix}.${detail.field}`,
  }));
  return new AppError({
    kind: error.kind,
    code: error.code,
    message: error.message,
    ...(details !== undefined && { details }),
    ...(error.retryAfterSeconds !== undefined && {
      retryAfterSeconds: error.retryAfterSeconds,
    }),
  });
}

// 経路を足さない失敗にはundefinedを返す
export type FieldPathPrefix =
  string | ((error: AppError) => string | undefined);

// ユースケースは詳細の欄を自身の入力からの相対の経路で返すため、GraphQLの引数の形のとおりの経路に直す
export async function withInputPath<T>(
  prefix: FieldPathPrefix,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    if (!(error instanceof AppError) || error.details === undefined) {
      throw error;
    }
    const resolved = typeof prefix === 'string' ? prefix : prefix(error);
    throw resolved === undefined ? error : withPrefixedFields(error, resolved);
  }
}
