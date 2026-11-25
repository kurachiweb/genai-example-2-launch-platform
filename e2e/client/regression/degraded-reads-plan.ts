import {
  type ExternalService,
  isExternalService,
} from '../../../scripts/readiness/core/degraded-overrides.ts';

export const DEGRADED_SERVICES_ENV_KEY = 'E2E_DEGRADED_SERVICES';

export type DegradedReads =
  | { readonly kind: 'skip'; readonly reason: string }
  | {
      readonly kind: 'run';
      readonly services: readonly ExternalService[];
      readonly paymentsStopped: boolean;
    };

type Env = Readonly<Record<string, string | undefined>>;

// 未設定の実行(通常のローカルの実行)が静かに縮退の確認を省いたことを、対象外の理由として残す
export function resolveDegradedReads(env: Env): DegradedReads {
  const names = (env[DEGRADED_SERVICES_ENV_KEY] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (names.length === 0) {
    return {
      kind: 'skip',
      reason: `${DEGRADED_SERVICES_ENV_KEY}が未設定のため、縮退の起動での読み取りを確かめない`,
    };
  }
  const unknown = names.filter((name) => !isExternalService(name));
  if (unknown.length > 0) {
    throw new Error(
      `${DEGRADED_SERVICES_ENV_KEY}に未知のサービスがあります: ${unknown.join(', ')}`,
    );
  }
  const services = [...new Set(names.filter(isExternalService))];
  return {
    kind: 'run',
    services,
    paymentsStopped: services.includes('stripe'),
  };
}
