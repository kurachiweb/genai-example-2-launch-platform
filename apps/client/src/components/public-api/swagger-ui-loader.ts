import { createClientOnlyFn } from '@tanstack/react-start';

import type { OpenApiDocument } from './openapi-document.ts';

export interface SwaggerUiRenderOptions {
  // Reactが子を描かない空の要素。Swagger UIが中身を作る
  readonly domNode: HTMLElement;
  // サーバーのURLを公開APIのオリジンの絶対URLにした仕様書
  readonly spec: OpenApiDocument;
}

export type RenderSwaggerUi = (options: SwaggerUiRenderOptions) => void;

export type SwaggerUiLoader = () => Promise<RenderSwaggerUi>;

export interface SwaggerUiBundleOptions extends SwaggerUiRenderOptions {
  readonly presets: readonly unknown[];
  readonly validatorUrl: null;
  readonly persistAuthorization: false;
  readonly deepLinking: false;
}

export interface SwaggerUiBundle {
  (options: SwaggerUiBundleOptions): unknown;
  readonly presets: { readonly apis: unknown };
}

export type ImportSwaggerUiBundle = () => Promise<SwaggerUiBundle>;

// 配布物の入口はNodeの組み込みモジュールを読むため、ブラウザ向けの束とスタイルを直接読む。サーバーのビルドから束を除くため、ブラウザ専用の関数の中で読み込む
const importSwaggerUiBundle: ImportSwaggerUiBundle = createClientOnlyFn(
  async (): Promise<SwaggerUiBundle> => {
    const [bundle] = await Promise.all([
      import('swagger-ui-dist/swagger-ui-bundle.js'),
      import('swagger-ui-dist/swagger-ui.css'),
    ]);
    return bundle.default;
  },
);

export const createSwaggerUiLoader =
  (
    importBundle: ImportSwaggerUiBundle = importSwaggerUiBundle,
  ): SwaggerUiLoader =>
  async () => {
    const SwaggerUIBundle = await importBundle();
    return ({ domNode, spec }) => {
      SwaggerUIBundle({
        domNode,
        spec,
        presets: [SwaggerUIBundle.presets.apis],
        // 仕様書を外部の検証サービスへ送らない
        validatorUrl: null,
        // 入力したAPIキーをブラウザの保存領域に残さない
        persistAuthorization: false,
        deepLinking: false,
      });
    };
  };

export const loadSwaggerUi: SwaggerUiLoader = createSwaggerUiLoader();
