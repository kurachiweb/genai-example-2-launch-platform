import type { OpenApiDocument } from './openapi-document.ts';

export interface SwaggerUiRenderOptions {
  // Reactが子を描かない空の要素。Swagger UIが中身を作る
  readonly domNode: HTMLElement;
  // サーバーのURLを公開APIのオリジンの絶対URLにした仕様書
  readonly spec: OpenApiDocument;
}

export type RenderSwaggerUi = (options: SwaggerUiRenderOptions) => void;

export type SwaggerUiLoader = () => Promise<RenderSwaggerUi>;

// Swagger UIの束を読み込めない時と同じく、ビューアーは読み込みの失敗の表示にする
export const loadSwaggerUi: SwaggerUiLoader = () =>
  Promise.reject(new Error('Swagger UIの束を読み込む処理がありません。'));
