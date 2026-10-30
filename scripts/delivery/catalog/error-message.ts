// 全層から読み込めるよう、最も下の層に置く
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
