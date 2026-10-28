import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..');
const REPOSITORY_ROOT = join(APP_DIR, '..', '..');

describe('共通部品の静的解析設定', () => {
  // コミット時の検査はリポジトリのルートを作業ディレクトリにして静的解析を起動するため、同じ条件で確かめる
  test('リポジトリのルートから起動しても、カタログの設定の追加機能を導入済みとして扱う', async () => {
    const child = Bun.spawn(
      [
        'bun',
        '--bun',
        join(APP_DIR, 'node_modules', '.bin', 'eslint'),
        '--no-warn-ignored',
        '--format',
        'json',
        join(APP_DIR, '.storybook', 'main.ts'),
      ],
      { cwd: REPOSITORY_ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const output = await new Response(child.stdout).text();
    await child.exited;

    const [result] = JSON.parse(output) as {
      messages: { ruleId: string | null }[];
    }[];

    expect(
      result?.messages.filter(
        (message) => message.ruleId === 'storybook/no-uninstalled-addons',
      ),
    ).toEqual([]);
  });
});
