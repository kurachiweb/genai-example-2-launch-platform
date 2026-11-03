export const INVITATION_TARGETS = Object.freeze([
  'local',
  'staging',
  'prod',
] as const);

export type InvitationTarget = (typeof INVITATION_TARGETS)[number];

export interface InvitationTargetConfig {
  readonly wranglerArgs: readonly string[];
  readonly adminOrigin: string;
}

const LOCAL_PERSIST_DIR = '/workspace/.wrangler/state';

const remote = (wranglerEnv: string): readonly string[] =>
  Object.freeze(['--remote', '--env', wranglerEnv]);

const TARGET_CONFIGS: Readonly<
  Record<InvitationTarget, InvitationTargetConfig>
> = Object.freeze({
  local: Object.freeze({
    wranglerArgs: Object.freeze(['--local', '--persist-to', LOCAL_PERSIST_DIR]),
    adminOrigin: 'http://localhost:48045',
  }),
  staging: Object.freeze({
    wranglerArgs: remote('staging'),
    adminOrigin: 'https://genai-example-2-admin-staging.lab.kurachiweb.com',
  }),
  prod: Object.freeze({
    wranglerArgs: remote('prod'),
    adminOrigin: 'https://genai-example-2-admin.lab.kurachiweb.com',
  }),
});

export function invitationTarget(
  target: InvitationTarget,
): InvitationTargetConfig {
  return TARGET_CONFIGS[target];
}
