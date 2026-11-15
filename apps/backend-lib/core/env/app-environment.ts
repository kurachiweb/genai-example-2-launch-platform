export const APP_ENVIRONMENTS = Object.freeze([
  'local',
  'staging',
  'prod',
] as const);
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export function isDeployedEnvironment(environment: AppEnvironment): boolean {
  return environment !== 'local';
}

// 環境の値の検証に失敗した後も他の設定の検査を続けるため、種別として正しい値のときだけデプロイ先と判定する
export function isDeployedEnvironmentValue(value: unknown): boolean {
  return (
    APP_ENVIRONMENTS.some((environment) => environment === value) &&
    isDeployedEnvironment(value as AppEnvironment)
  );
}
