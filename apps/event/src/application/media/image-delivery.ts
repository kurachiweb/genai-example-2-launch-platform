import {
  IMAGE_CACHE_CONTROL,
  IMAGE_VARIANTS,
  type ImageExtension,
  type ImageOriginal,
  isDeliverable,
  parseImagePath,
} from '../../../common-lib/media/image-variants.ts';
import {
  isImageMediaType,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  type ErrorResponseParts,
  NOT_FOUND_RESPONSE,
  toErrorResponse,
} from '../../../lib/core/errors/error-envelope.ts';
import {
  MEDIA_RETRY_AFTER_SECONDS,
  MEDIA_UNAVAILABLE_MESSAGE,
} from '../../../lib/core/media/media-unavailable.ts';
import type {
  ImageSource,
  ImageTransformer,
  ImageTransformFormat,
} from './ports.ts';

export const SVG_CONTENT_SECURITY_POLICY =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

export interface ImageDeliveryDeps {
  readonly source: ImageSource;
  readonly transformer: ImageTransformer;
}

const IMAGE_TRANSFORM_QUALITY = 80;

const SVG_MEDIA_TYPE = 'image/svg+xml';

const TRANSFORM_FORMATS: Readonly<
  Record<Exclude<ImageExtension, 'svg'>, ImageTransformFormat>
> = Object.freeze({
  avif: 'image/avif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
});

// 受付と判定は本文をUTF-8として読むため、XML宣言のencodingより優先されるcharsetでブラウザにも同じ解釈をさせる
const SVG_CONTENT_TYPE = `${SVG_MEDIA_TYPE}; charset=utf-8`;

const SVG_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': SVG_CONTENT_TYPE,
  'Content-Security-Policy': SVG_CONTENT_SECURITY_POLICY,
  'Cache-Control': IMAGE_CACHE_CONTROL,
});

const IMAGE_UNAVAILABLE_RESPONSE: ErrorResponseParts = toErrorResponse(
  new AppError({
    kind: 'unavailable',
    code: 'image_unavailable',
    message: MEDIA_UNAVAILABLE_MESSAGE,
    retryAfterSeconds: MEDIA_RETRY_AFTER_SECONDS,
  }),
);

const isHead = (request: Request): boolean => request.method === 'HEAD';

async function imageResponse(
  request: Request,
  body: ReadableStream<Uint8Array>,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  if (isHead(request)) {
    await body.cancel();
    return new Response(null, { status: 200, headers });
  }
  return new Response(body, { status: 200, headers });
}

function errorResponse(request: Request, parts: ErrorResponseParts): Response {
  if (isHead(request)) {
    return new Response(null, { status: parts.status, headers: parts.headers });
  }
  return Response.json(parts.body, {
    status: parts.status,
    headers: parts.headers,
  });
}

function originalOf(
  contentType: string | undefined,
): ImageOriginal | undefined {
  const type = parseMediaType(contentType ?? null);
  if (type === undefined || !isImageMediaType(type)) {
    return undefined;
  }
  return type === SVG_MEDIA_TYPE ? 'svg' : 'raster';
}

export async function deliverImage(
  request: Request,
  deps: ImageDeliveryDeps,
): Promise<Response> {
  const match = parseImagePath(new URL(request.url).pathname);
  if (match.kind !== 'image') {
    return errorResponse(request, NOT_FOUND_RESPONSE);
  }
  const { objectKey, variant, extension } = match;
  const original = await deps.source.get(objectKey);
  if (original === undefined) {
    return errorResponse(request, NOT_FOUND_RESPONSE);
  }
  const kind = originalOf(original.contentType);
  if (kind === undefined || !isDeliverable(variant, extension, kind)) {
    await original.body.cancel();
    return errorResponse(request, NOT_FOUND_RESPONSE);
  }
  // 配信できる組み合わせで拡張子がsvgになるのはSVG原本だけである
  if (extension === 'svg') {
    return imageResponse(request, original.body, SVG_HEADERS);
  }
  const result = await deps.transformer.transform({
    body: original.body,
    variant: IMAGE_VARIANTS[variant],
    format: TRANSFORM_FORMATS[extension],
    quality: IMAGE_TRANSFORM_QUALITY,
    anim: false,
  });
  if (!result.ok) {
    return errorResponse(
      request,
      result.reason === 'invalid-image'
        ? NOT_FOUND_RESPONSE
        : IMAGE_UNAVAILABLE_RESPONSE,
    );
  }
  return imageResponse(request, result.body, {
    'Content-Type': result.contentType,
    'Cache-Control': IMAGE_CACHE_CONTROL,
  });
}
