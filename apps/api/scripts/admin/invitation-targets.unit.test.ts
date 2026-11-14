import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { readWranglerConfig } from '../../test/support/wrangler-config.ts';
import {
  INVITATION_TARGETS,
  type InvitationTarget,
  invitationTarget,
} from './invitation-targets.ts';

const varsSchema = z.object({
  vars: z.object({ ADMIN_SITE_ORIGIN: z.string() }),
});

const packageScriptsSchema = z.object({
  scripts: z.object({ dev: z.string(), 'db:migrate:local': z.string() }),
});

const packageScripts = packageScriptsSchema.parse(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'),
  ),
).scripts;

const persistDirOf = (command: string): string | undefined =>
  /--persist-to (\S+)/.exec(command)?.[1];

const wranglerEnvOf = (args: readonly string[]): string | undefined => {
  const index = args.indexOf('--env');
  return index === -1 ? undefined : args[index + 1];
};

describe('INVITATION_TARGETS', () => {
  test('ローカル・staging・prodの3つの環境を指定できる', () => {
    expect(INVITATION_TARGETS).toEqual(['local', 'staging', 'prod']);
  });
});

describe('invitationTarget', () => {
  test.each<[InvitationTarget, readonly string[], string]>([
    [
      'local',
      ['--local', '--persist-to', '/workspace/.wrangler/state'],
      'http://localhost:48045',
    ],
    [
      'staging',
      ['--remote', '--env', 'staging'],
      'https://genai-example-2-admin-staging.lab.kurachiweb.com',
    ],
    [
      'prod',
      ['--remote', '--env', 'prod'],
      'https://genai-example-2-admin.lab.kurachiweb.com',
    ],
  ])(
    '%sではWranglerの引数と管理者側のオリジンを返す',
    (target, wranglerArgs, adminOrigin) => {
      expect(invitationTarget(target)).toEqual({ wranglerArgs, adminOrigin });
    },
  );

  test.each(INVITATION_TARGETS)(
    '%sの管理者側のオリジンは、Wrangler設定の同じ環境のADMIN_SITE_ORIGINと一致する',
    (target) => {
      const { wranglerArgs, adminOrigin } = invitationTarget(target);

      const config = varsSchema.parse(
        readWranglerConfig('api', wranglerEnvOf(wranglerArgs)),
      );

      expect(adminOrigin).toBe(config.vars.ADMIN_SITE_ORIGIN);
    },
  );

  test('ローカルの保存先は、開発サーバーとローカルのマイグレーションの適用先と同じ', () => {
    const persistDir = persistDirOf(
      invitationTarget('local').wranglerArgs.join(' '),
    );

    expect(persistDir).toBeDefined();
    expect(persistDirOf(packageScripts.dev)).toBe(persistDir);
    expect(persistDirOf(packageScripts['db:migrate:local'])).toBe(persistDir);
  });

  test('返す設定は書き換えられない', () => {
    const config = invitationTarget('local');

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.wranglerArgs)).toBe(true);
  });
});
