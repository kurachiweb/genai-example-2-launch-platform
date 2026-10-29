import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { createRecordingOutput } from '../../test-fixtures/text-output.ts';
import { createDefaultDeps } from './default-deps.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

describe('createDefaultDeps', () => {
  test('リポジトリのルート・環境・出力先を、実際の入出力の部品と共に組み立てる', async () => {
    const stdout = createRecordingOutput();
    const stderr = createRecordingOutput();
    const env = { PATH: process.env.PATH, DELIVERY_DEPS: 'value' };

    const deps = createDefaultDeps({
      repoRoot: REPO_ROOT,
      env,
      stdout,
      stderr,
    });

    expect(deps.repoRoot).toBe(REPO_ROOT);
    expect(deps.env).toBe(env);
    expect(deps.stdout).toBe(stdout);
    expect(deps.stderr).toBe(stderr);
    expect(deps.files.root).toBe(REPO_ROOT);
    expect(await deps.files.exists('package.json')).toBe(true);
    const result = await deps.runner.run({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.DELIVERY_DEPS ?? "")'],
      output: 'capture',
    });
    expect(result.stdout).toBe('value');
    expect(typeof deps.secrets.login).toBe('function');
    expect(typeof deps.secrets.exportFolder).toBe('function');
    deps.github.mask('outside-actions');
    expect(stdout.text()).toBe('');
  });
});
