export const MEDIA_TYPE_DEFS = /* GraphQL */ `
  "AVIF・WebPに非対応のブラウザ向けの形式。原本がJPEGならJPG、SVGならSVG(SVGはこの形式だけで表示する)、それ以外はPNG"
  enum MediaImageFallbackFormat {
    JPG
    PNG
    SVG
  }

  "画像用の用途のファイル"
  type MediaImage {
    id: ID!
    "隔離中・削除待ち・保存未完了の画像は空"
    objectKey: String
    fallbackFormat: MediaImageFallbackFormat!
    width: Int
    height: Int
  }

  "ファイル用の用途のファイル"
  type MediaAttachment {
    id: ID!
    originalFileName: String!
    contentType: String!
    byteSize: Int!
    "フロントエンドサーバーのダウンロードのパス"
    downloadPath: String!
  }
`;
