import type {
  DeployEnvironment,
  WorkerKey,
} from '../catalog/resource-catalog.ts';
import { PLACEHOLDER_UUID } from './resource-catalog.ts';

export const STAGING_D1_DATABASE_ID = '3f9c2b1a-6d4e-4f8a-9b7c-1e2d3c4b5a69';

const d1DatabaseIdOf = (env: DeployEnvironment): string =>
  env === 'staging' ? STAGING_D1_DATABASE_ID : PLACEHOLDER_UUID;

const d1Section = (env: DeployEnvironment): string => `"d1_databases": [
      {
        "binding": "DB",
        "database_name": "app-${env}",
        "database_id": "${d1DatabaseIdOf(env)}",
      },
    ],`;

const r2Section = (env: DeployEnvironment): string => `"r2_buckets": [
      { "binding": "IMAGES_BUCKET", "bucket_name": "app-images-${env}", "jurisdiction": "us" },
      { "binding": "FILES_BUCKET", "bucket_name": "app-files-${env}", "jurisdiction": "us" },
      { "binding": "QUARANTINE_BUCKET", "bucket_name": "app-quarantine-${env}", "jurisdiction": "us" },
    ],`;

const apiEnvSection = (env: DeployEnvironment): string => `{
    ${d1Section(env)}
    ${r2Section(env)}
    "queues": {
      "producers": [{ "binding": "JOBS_QUEUE", "queue": "app-jobs-${env}" }],
    },
    "vars": { "LOG_LEVEL": "info", "APP_ENVIRONMENT": "${env}" },
    "secrets": { "required": ["HASH_PEPPER", "SENTRY_DSN"] },
  }`;

const eventEnvSection = (env: DeployEnvironment): string => `{
    ${d1Section(env)}
    ${r2Section(env)}
    "queues": {
      "producers": [
        { "binding": "JOBS_QUEUE", "queue": "app-jobs-${env}" },
        { "binding": "JOBS_DLQ", "queue": "app-jobs-dlq-${env}" },
      ],
      "consumers": [
        { "queue": "app-jobs-${env}", "dead_letter_queue": "app-jobs-dlq-${env}" },
        { "queue": "app-jobs-dlq-${env}" },
        { "queue": "app-email-events-${env}", "dead_letter_queue": "app-jobs-dlq-${env}" },
      ],
    },
    "vars": { "LOG_LEVEL": "info" },
    "secrets": { "required": ["HASH_PEPPER"] },
  }`;

const frontendEnvSection = (env: DeployEnvironment): string => `{
    "services": [
      { "binding": "API", "service": "app-api-${env}", "entrypoint": "ClientGateway" },
    ],
    "vars": { "TURNSTILE_SITE_KEY": "0x0000000000000000000000" },
    "secrets": { "required": ["HASH_PEPPER"] },
  }`;

const ENV_SECTIONS: Readonly<
  Record<WorkerKey, (env: DeployEnvironment) => string>
> = {
  api: apiEnvSection,
  event: eventEnvSection,
  client: frontendEnvSection,
  admin: frontendEnvSection,
};

export const wranglerJsoncOf = (worker: WorkerKey): string => `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "app-${worker}",
  "main": "src/index.ts",
  "workers_dev": false,
  "preview_urls": false,
  // ローカル開発の値は環境へ継承されない
  "d1_databases": [
    { "binding": "DB", "database_name": "app-dev", "database_id": "00000000-0000-4000-8000-000000000001" },
  ],
  "vars": { "LOG_LEVEL": "debug" },
  "env": {
    "staging": ${ENV_SECTIONS[worker]('staging')},
    "prod": ${ENV_SECTIONS[worker]('prod')},
  },
}
`;

export const wranglerFileOf = (worker: WorkerKey): string =>
  `apps/${worker}/wrangler.jsonc`;

export const BACKEND_FILE = 'apps/infra/backends/staging.s3.hcl';

export const backendHclOf = (
  accountId: string,
): string => `bucket = "app-tofu-state-staging"
key    = "live/terraform.tfstate"
endpoints = {
  s3 = "https://${accountId}.r2.cloudflarestorage.com"
}
`;
