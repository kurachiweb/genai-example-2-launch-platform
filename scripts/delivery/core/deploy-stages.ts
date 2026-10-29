export const DEPLOY_STAGES = [
  'preflight',
  'tofu-foundation',
  'reconcile-ids',
  'migrate',
  'deploy-api',
  'deploy-event',
  'deploy-client',
  'deploy-admin',
  'tofu-routing',
  'email-subscription',
  'verify',
] as const;

export type DeployStage = (typeof DEPLOY_STAGES)[number];
