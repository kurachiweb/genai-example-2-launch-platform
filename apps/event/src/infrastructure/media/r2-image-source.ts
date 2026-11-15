import type {
  ImageSource,
  SourceImage,
} from '../../application/media/ports.ts';

// 配信は画像用非公開バケットだけを読み、隔離バケットに移った画像を返さない
export class R2ImageSource implements ImageSource {
  constructor(private readonly bucket: R2Bucket) {}

  async get(objectKey: string): Promise<SourceImage | undefined> {
    const object = await this.bucket.get(objectKey);
    if (object === null) {
      return undefined;
    }
    return {
      // Workersの型定義はR2の本文の要素の型を定めないが、R2の本文はバイト列の塊を流す
      body: object.body as ReadableStream<Uint8Array>,
      contentType: object.httpMetadata?.contentType,
    };
  }
}
