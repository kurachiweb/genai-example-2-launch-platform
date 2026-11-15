// DBディレクトリのKEYWORD_STATUSESと同じ値に保つ。coreはDBディレクトリを読み込めないため、一致は共通ライブラリのworkersの型で保証する
export type KeywordStatus =
  'pending' | 'extracted' | 'fallback' | 'unsupported' | 'disabled';
