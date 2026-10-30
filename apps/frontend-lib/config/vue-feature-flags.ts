// エディタの内部のUIはVueの描画関数で作られ、オプションAPI・本番の開発者ツール・ハイドレーションの不一致の詳細を使わない。
// esm-bundler版のVueはビルド時の機能フラグが未定義だと開発時に警告し、使わない機能のコードも残すため、無効に定義する
export const VUE_FEATURE_FLAGS: Readonly<Record<string, string>> = {
  __VUE_OPTIONS_API__: 'false',
  __VUE_PROD_DEVTOOLS__: 'false',
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
};
