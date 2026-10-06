import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_TSCONFIG_PATH = join(import.meta.dirname, 'tsconfig.base.json');

const PARAMETER_DECORATOR_PROBE = [
  'const calls: string[] = [];',
  'function inject(name: string) {',
  '  return (_target: object, _key: string | symbol | undefined, index: number) => {',
  '    calls.push(`${name}:${String(index)}`);',
  '  };',
  '}',
  'class Service {',
  "  constructor(@inject('repository') readonly repository: string) {}",
  '}',
  "new Service('x');",
  'process.stdout.write(JSON.stringify(calls));',
  '',
].join('\n');

let workDir = '';

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'tsconfig-base-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('tsconfig.base.json', () => {
  // Bunはextendsを持つtsconfigのexperimentalDecoratorsを継承元の値だけで決めるため、継承する側では有効にできない
  test('継承したアプリでBunがパラメータデコレータを実行する', async () => {
    const appDir = join(workDir, 'app');
    await mkdir(appDir, { recursive: true });
    await writeFile(
      join(appDir, 'tsconfig.json'),
      JSON.stringify({ extends: BASE_TSCONFIG_PATH }),
    );
    await writeFile(join(appDir, 'probe.ts'), PARAMETER_DECORATOR_PROBE);

    const result = Bun.spawnSync([process.execPath, 'probe.ts'], {
      cwd: appDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('["repository:0"]');
  });
});
