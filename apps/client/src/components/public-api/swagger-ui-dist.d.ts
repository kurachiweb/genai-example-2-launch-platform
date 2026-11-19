// 配布物は型定義を持たないため、ブラウザ向けの束のうち使う部分だけを宣言する
declare module 'swagger-ui-dist/swagger-ui-bundle.js' {
  interface SwaggerUIBundleFunction {
    (options: object): unknown;
    readonly presets: { readonly apis: unknown };
  }

  const SwaggerUIBundle: SwaggerUIBundleFunction;
  export default SwaggerUIBundle;
}
