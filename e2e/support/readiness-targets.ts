import { resolveLocalWorkerOrigin } from './local-worker-origins.ts';

export interface ReadinessTargets {
  readonly api: string;
  readonly event: string;
  readonly images: string;
}

const IMAGES_ORIGIN_ENV_KEY = 'E2E_IMAGES_URL';

// ローカルではイベントサーバーが画像配信を兼ねるため、画像配信の既定はイベントサーバーの既定のオリジンと同じにする
export function resolveReadinessTargets(
  env: Readonly<Record<string, string | undefined>>,
): ReadinessTargets {
  return {
    api: resolveLocalWorkerOrigin('api', env),
    event: resolveLocalWorkerOrigin('event', env),
    images: env[IMAGES_ORIGIN_ENV_KEY] || resolveLocalWorkerOrigin('event', {}),
  };
}
