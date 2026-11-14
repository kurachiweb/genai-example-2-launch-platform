export const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000';

export const PLACEHOLDER_CLOUDFLARE_ID = '00000000000000000000000000000000';

export const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';

export const PROJECT_ID = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

export const validCatalogJson = (): Record<string, unknown> => ({
  environment: 'staging',
  cloudflare: {
    accountId: ACCOUNT_ID,
    zoneId: 'fedcba9876543210fedcba9876543210',
    zoneName: 'launch.example',
  },
  jurisdiction: 'us',
  d1: { main: { name: 'app-staging' } },
  r2: {
    images: { name: 'app-images-staging' },
    files: { name: 'app-files-staging' },
    quarantine: { name: 'app-quarantine-staging' },
  },
  queues: {
    jobs: { name: 'app-jobs-staging' },
    'jobs-dlq': { name: 'app-jobs-dlq-staging' },
    'email-events': { name: 'app-email-events-staging' },
  },
  workers: {
    api: { name: 'app-api-staging' },
    event: { name: 'app-event-staging' },
    client: { name: 'app-client-staging' },
    admin: { name: 'app-admin-staging' },
  },
  hostnames: {
    api: { hostname: 'api-staging.launch.example', worker: 'api' },
    event: { hostname: 'event-staging.launch.example', worker: 'event' },
    client: { hostname: 'client-staging.launch.example', worker: 'client' },
    admin: { hostname: 'admin-staging.launch.example', worker: 'admin' },
    images: { hostname: 'images-staging.launch.example', worker: 'event' },
  },
  turnstile: {
    name: 'app-staging',
    hostnames: [
      'client-staging.launch.example',
      'admin-staging.launch.example',
    ],
    mode: 'invisible',
  },
  webAnalytics: { hostname: 'client-staging.launch.example' },
  emailSending: {
    domain: 'mail-staging.launch.example',
    eventsQueue: 'email-events',
    events: [
      'message.bounced',
      'message.complained',
      'message.rejected',
      'message.failed',
    ],
    subscriptionName: 'app-email-subscription-staging',
  },
  state: { bucket: 'app-tofu-state-staging', key: 'live/terraform.tfstate' },
  infisical: {
    host: 'https://secrets.launch.example',
    projectId: PROJECT_ID,
    identityId: PLACEHOLDER_UUID,
    oidcAudience: 'https://ci.launch.example',
  },
  github: { environment: 'staging', branch: 'main' },
});
