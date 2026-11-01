import type { ImageVariantSpec } from '../../../common-lib/media/image-variants.ts';

export type ModerationImageFormat = 'png' | 'jpeg';

export type ModerationImagePlan =
  | { readonly kind: 'as-is'; readonly format: ModerationImageFormat }
  | {
      readonly kind: 'resize';
      readonly width: number;
      readonly height: number;
      readonly format: ModerationImageFormat;
    }
  | {
      readonly kind: 'pad';
      readonly width: number;
      readonly height: number;
      readonly canvasWidth: number;
      readonly canvasHeight: number;
    };

export interface ModerationImage {
  readonly bytes: Uint8Array;
  readonly format: ModerationImageFormat;
}

export type ModerationImageRenderResult =
  | { readonly ok: true; readonly image: ModerationImage }
  | { readonly ok: false; readonly reason: 'undecodable' };

export interface ModerationImageRenderer {
  render(input: {
    readonly original: Uint8Array;
    readonly plan: ModerationImagePlan;
  }): Promise<ModerationImageRenderResult>;
}

export interface ModerationLabel {
  readonly name: string;
  // 最上位のカテゴリのラベルは空文字
  readonly parentName: string;
  readonly confidence: number;
  readonly taxonomyLevel: number;
}

export type ModerationOutcome =
  | { readonly kind: 'labels'; readonly labels: readonly ModerationLabel[] }
  | {
      readonly kind: 'transient';
      readonly reason:
        'throttled' | 'service-error' | 'timeout' | 'network' | 'misconfigured';
    }
  | {
      readonly kind: 'rejected';
      readonly reason: 'invalid-image' | 'too-large' | 'invalid-parameter';
    };

// 判定サービスへは判定用画像と閾値だけを渡し、元のファイル名・アップロードした主体を渡さない
export interface ModerationProvider {
  detect(
    image: ModerationImage,
    minConfidence: number,
  ): Promise<ModerationOutcome>;
}

export interface MediaIncidentReporter {
  undetermined(fileId: string, reason: string): void;
  rejectedByService(fileId: string, reason: string): void;
  misconfigured(reason: string): void;
}

export interface FileRelocator {
  reconcile(fileIds: readonly string[]): Promise<{ readonly moved: number }>;
}

export type ImageCachePurgeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorCodes: readonly number[] };

export interface ImageCachePurger {
  purge(objectKeys: readonly string[]): Promise<ImageCachePurgeResult>;
}

export interface SourceImage {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string | undefined;
}

export interface ImageSource {
  get(objectKey: string): Promise<SourceImage | undefined>;
}

export type ImageTransformFormat =
  'image/avif' | 'image/webp' | 'image/jpeg' | 'image/png';

export type ImageTransformResult =
  | {
      readonly ok: true;
      readonly body: ReadableStream<Uint8Array>;
      readonly contentType: string;
    }
  | { readonly ok: false; readonly reason: 'invalid-image' | 'unavailable' };

export interface ImageTransformer {
  transform(input: {
    readonly body: ReadableStream<Uint8Array>;
    readonly variant: ImageVariantSpec;
    readonly format: ImageTransformFormat;
  }): Promise<ImageTransformResult>;
}

const ModerationProvider: unique symbol = Symbol.for(
  'media.ModerationProvider',
);
const ModerationImageRenderer: unique symbol = Symbol.for(
  'media.ModerationImageRenderer',
);
const MediaIncidentReporter: unique symbol = Symbol.for(
  'media.MediaIncidentReporter',
);
const FileRelocator: unique symbol = Symbol.for('media.FileRelocator');
const ImageCachePurger: unique symbol = Symbol.for('media.ImageCachePurger');

export const EVENT_MEDIA_TYPES = Object.freeze({
  ModerationProvider,
  ModerationImageRenderer,
  MediaIncidentReporter,
  FileRelocator,
  ImageCachePurger,
});
