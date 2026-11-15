import { parseImagePath } from '../../../common-lib/media/image-variants.ts';

export interface ImageDeliveryHostConfig {
  readonly hostname: string;
  readonly dedicated: boolean;
}

// IP制限の除外は環境の検証より前に動くため、キーが欠けた環境も受け取る
export interface ImageDeliveryHostEnv {
  readonly IMAGE_DELIVERY_HOSTNAME?: string;
  readonly IMAGE_DELIVERY_DEDICATED_HOST?: string;
}

export type ImageRequestMatch =
  | { readonly kind: 'image'; readonly path: string }
  | { readonly kind: 'reject-on-dedicated-host' }
  | { readonly kind: 'not-image-host' };

const REJECT_ON_DEDICATED_HOST: ImageRequestMatch = Object.freeze({
  kind: 'reject-on-dedicated-host',
});

const NOT_IMAGE_HOST: ImageRequestMatch = Object.freeze({
  kind: 'not-image-host',
});

export function imageDeliveryHostConfigOf(
  env: ImageDeliveryHostEnv,
): ImageDeliveryHostConfig {
  return {
    hostname: env.IMAGE_DELIVERY_HOSTNAME ?? '',
    dedicated: env.IMAGE_DELIVERY_DEDICATED_HOST === 'true',
  };
}

// バリアント名・拡張子が未定義でも画像のURLの形式なら画像配信へ渡し、配信側の404(no-store)に任せる
export function matchImageRequest(
  url: URL,
  config: ImageDeliveryHostConfig,
): ImageRequestMatch {
  const hostname = config.hostname.toLowerCase();
  if (hostname === '' || url.hostname !== hostname) {
    return NOT_IMAGE_HOST;
  }
  if (parseImagePath(url.pathname).kind !== 'not-image-path') {
    return { kind: 'image', path: url.pathname };
  }
  return config.dedicated ? REJECT_ON_DEDICATED_HOST : NOT_IMAGE_HOST;
}

export function isImageDeliveryRequest(
  request: Request,
  env: ImageDeliveryHostEnv,
): boolean {
  return (
    matchImageRequest(new URL(request.url), imageDeliveryHostConfigOf(env))
      .kind === 'image'
  );
}
