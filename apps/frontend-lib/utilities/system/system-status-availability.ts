export type AppEnvironment = 'local' | 'staging' | 'prod';

const SYSTEM_STATUS_ENVIRONMENTS: ReadonlySet<AppEnvironment> = new Set([
  'local',
  'staging',
]);

export const isSystemStatusAvailable = (environment: AppEnvironment): boolean =>
  SYSTEM_STATUS_ENVIRONMENTS.has(environment);
