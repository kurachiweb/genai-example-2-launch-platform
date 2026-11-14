import { type AppName, APPS } from '../../../config/workspace-layout.ts';
import type { WorkerKey } from '../catalog/resource-catalog.ts';

// @cloudflare/vite-pluginでビルドするアプリは環境をビルドの時に決め、wrangler deployはビルドが出力したWrangler設定を使う
export const VITE_BUILT_WORKERS: ReadonlySet<WorkerKey> = new Set([
  'client',
  'admin',
]);

export function appDirOf(app: AppName): string {
  const found = APPS.find(({ name }) => name === app);
  if (found === undefined) {
    throw new Error(`アプリの一覧に${app}がありません。`);
  }
  return found.dir;
}
