export const PLAN_SECRET_VALUES: readonly string[] = [
  'fake-turnstile-secret-value',
  'fake-planned-database-name',
  'fake-prior-hostname-value',
  'fake-state-passphrase-in-variables',
];

const resourceChange = (
  address: string,
  actions: readonly string[],
): Record<string, unknown> => ({
  address,
  mode: 'managed',
  type: address.split('.').at(-2) ?? '',
  name: 'this',
  change: {
    actions,
    before: { name: 'fake-prior-hostname-value' },
    after: {
      name: 'fake-planned-database-name',
      secret: 'fake-turnstile-secret-value',
    },
    after_sensitive: { secret: true },
  },
});

export const D1_ADDRESS = 'module.storage.cloudflare_d1_database.this["main"]';
export const QUEUE_ADDRESS = 'module.messaging.cloudflare_queue.this["jobs"]';
export const TURNSTILE_ADDRESS =
  'module.edge_services.cloudflare_turnstile_widget.this';
export const ROUTING_ADDRESS =
  'module.worker_routing.cloudflare_workers_custom_domain.this["api"]';
export const R2_ADDRESS = 'module.storage.cloudflare_r2_bucket.this["images"]';
export const DATA_ADDRESS = 'data.cloudflare_zone.this';

export const planJsonOf = (
  changes: readonly (readonly [string, readonly string[]])[],
): string =>
  JSON.stringify({
    format_version: '1.2',
    terraform_version: '1.13.2',
    variables: {
      environment: { value: 'staging' },
      state_passphrase: { value: 'fake-state-passphrase-in-variables' },
    },
    resource_changes: changes.map(([address, actions]) =>
      resourceChange(address, actions),
    ),
  });

export const CREATE_ONLY_PLAN_JSON = planJsonOf([
  [D1_ADDRESS, ['create']],
  [QUEUE_ADDRESS, ['no-op']],
]);
