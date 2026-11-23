import { resolveReadinessTargets } from '../../support/readiness-targets.ts';

export type BackendTargetName = 'api' | 'event' | 'images';

export type BackendTarget =
  | { readonly kind: 'run'; readonly origin: string }
  | { readonly kind: 'skip'; readonly reason: string };

const ORIGIN_ENV_KEYS: Readonly<Record<BackendTargetName, string>> = {
  api: 'E2E_API_URL',
  event: 'E2E_EVENT_URL',
  images: 'E2E_IMAGES_URL',
};

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

export function isLocalOrigin(origin: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const skipReasonOf = (envKey: string): string =>
  `${envKey}が未設定で、利用者側の対象がローカルでないため対象外`;

// デプロイ後のスモークは利用者側と管理者側のURLだけを渡すため、他のサーバーのURLを渡していない環境では、既定のローカルのオリジンへ要求せず対象外にする
export function resolveBackendBaselineTargets(
  env: Readonly<Record<string, string | undefined>>,
  clientBaseURL: string,
): Readonly<Record<BackendTargetName, BackendTarget>> {
  const origins = resolveReadinessTargets(env);
  const clientIsLocal = isLocalOrigin(clientBaseURL);
  const targetOf = (name: BackendTargetName): BackendTarget => {
    const envKey = ORIGIN_ENV_KEYS[name];
    return clientIsLocal || env[envKey]
      ? { kind: 'run', origin: origins[name] }
      : { kind: 'skip', reason: skipReasonOf(envKey) };
  };
  return {
    api: targetOf('api'),
    event: targetOf('event'),
    images: targetOf('images'),
  };
}
