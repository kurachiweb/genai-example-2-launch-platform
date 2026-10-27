import { join } from 'node:path';

import { unstable_readConfig } from 'wrangler';

export type WranglerAppName = 'api' | 'event';

const APPS_DIR = join(import.meta.dirname, '..', '..', '..');

// メールの設定はメール送信基盤の設定の検査が受け持ち、他の設定の検査はこのキーを除いて比べる
export const EMAIL_CONFIG_KEY_PATTERN: RegExp = /^(?:EMAIL_|MAILPIT_)/;

export function appPath(app: WranglerAppName, ...segments: string[]): string {
  return join(APPS_DIR, app, ...segments);
}

export function readWranglerConfig(
  app: WranglerAppName,
  wranglerEnv: string | undefined,
): unknown {
  return unstable_readConfig(
    { config: appPath(app, 'wrangler.jsonc'), env: wranglerEnv },
    { hideWarnings: true },
  );
}
