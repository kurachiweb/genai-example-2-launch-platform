import { describe, expect, test } from 'bun:test';

import { WORKER_KEYS } from '../catalog/resource-catalog.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
  withoutPath,
} from '../test-fixtures/repo-files.ts';
import { validCatalogJson } from '../test-fixtures/resource-catalog.ts';
import {
  backendHclOf,
  wranglerFileOf,
  wranglerJsoncOf,
} from '../test-fixtures/wrangler-config.ts';
import { replaceOnce } from '../test-fixtures/workflows.ts';
import { command } from './contract-check.ts';
import { EXIT_FAILURE, EXIT_SUCCESS } from './shared/delivery-command.ts';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';

const STAGING_CATALOG = 'apps/infra/environments/staging.json';
const PROD_CATALOG = 'apps/infra/environments/prod.json';
const STAGING_BACKEND = 'apps/infra/backends/staging.s3.hcl';
const PROD_BACKEND = 'apps/infra/backends/prod.s3.hcl';

const prodCatalogJson = (): Record<string, unknown> => ({
  ...(JSON.parse(
    JSON.stringify(validCatalogJson()).replaceAll('staging', 'prod'),
  ) as Record<string, unknown>),
  github: { environment: 'prod', branch: 'prod' },
});

const validTexts = (): Record<string, string> => ({
  [STAGING_CATALOG]: JSON.stringify(validCatalogJson()),
  [PROD_CATALOG]: JSON.stringify(prodCatalogJson()),
  ...Object.fromEntries(
    WORKER_KEYS.map((worker) => [
      wranglerFileOf(worker),
      wranglerJsoncOf(worker),
    ]),
  ),
  [STAGING_BACKEND]: backendHclOf(ACCOUNT_ID),
  [PROD_BACKEND]: backendHclOf(ACCOUNT_ID).replaceAll('staging', 'prod'),
});

const runWith = async (
  texts: Readonly<Record<string, string>>,
  args: readonly string[] = [],
) => {
  const files = createFakeRepoFiles(texts);
  const fake = createFakeDeps(files);
  const code = await command.run(args, fake.deps);
  return { ...fake, code, readPaths: files.readPaths() };
};

const editText = (
  texts: Readonly<Record<string, string>>,
  path: string,
  edit: (text: string) => string,
): Record<string, string> => ({ ...texts, [path]: edit(texts[path] ?? '') });

describe('contract-check', () => {
  test('両環境の資源一覧・4アプリのWrangler設定・backend設定を読み、違反が無ければ終了コード0で違反が無い旨を書く', async () => {
    const { code, readPaths, stdout, stderr, summaries } =
      await runWith(validTexts());

    expect(code).toBe(EXIT_SUCCESS);
    expect(readPaths).toEqual(
      [
        STAGING_CATALOG,
        PROD_CATALOG,
        ...WORKER_KEYS.map(wranglerFileOf),
        STAGING_BACKEND,
        PROD_BACKEND,
      ].toSorted(),
    );
    expect(stdout.text()).toBe('構成検査: 違反はありません。\n');
    expect(stderr.text()).toBe('');
    expect(summaries()).toEqual(['### 構成検査\n\n違反はありません。\n']);
  });

  test('両環境の違反を規則・ファイル・項目・実際・期待の表で出し、手順の要約にも書いて終了コード1を返す', async () => {
    const texts = editText(
      editText(validTexts(), wranglerFileOf('api'), (text) =>
        replaceOnce(
          text,
          '"bucket_name": "app-images-staging", "jurisdiction": "us"',
          '"bucket_name": "app-images-staging"',
        ),
      ),
      PROD_BACKEND,
      (text) =>
        replaceOnce(text, 'app-tofu-state-prod', 'app-tofu-state-wrong'),
    );

    const { code, stdout, stderr, summaries } = await runWith(texts);

    expect(code).toBe(EXIT_FAILURE);
    expect(stdout.text()).toBe('');
    const lines = stderr.text().split('\n');
    expect(lines[0]).toBe('構成検査: 違反が2件あります。');
    expect(lines[1]).toMatch(/^規則\s+ファイル\s+項目\s+実際\s+期待$/);
    expect(lines[2]).toMatch(
      /^C3\s+apps\/api\/wrangler\.jsonc\s+env\.staging\.r2_buckets\[IMAGES_BUCKET\]\.jurisdiction\s+\(なし\)\s+us$/,
    );
    expect(lines[3]).toMatch(
      /^C7\s+apps\/infra\/backends\/prod\.s3\.hcl\s+bucket\s+app-tofu-state-wrong\s+app-tofu-state-prod$/,
    );
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0]).toContain(
      '| 規則 | ファイル | 項目 | 実際 | 期待 |',
    );
    expect(summaries()[0]).toContain(
      '| C3 | apps/api/wrangler.jsonc | env.staging.r2_buckets[IMAGES_BUCKET].jurisdiction | (なし) | us |',
    );
    expect(summaries()[0]).toContain(
      '| C7 | apps/infra/backends/prod.s3.hcl | bucket | app-tofu-state-wrong | app-tofu-state-prod |',
    );
  });

  test('両環境が継承する最上位のキーの違反は、同じ行を1件にまとめて出す', async () => {
    const texts = editText(validTexts(), wranglerFileOf('client'), (text) =>
      replaceOnce(text, '"workers_dev": false', '"workers_dev": true'),
    );

    const { code, stderr } = await runWith(texts);

    expect(code).toBe(EXIT_FAILURE);
    const lines = stderr.text().split('\n');
    expect(lines[0]).toBe('構成検査: 違反が1件あります。');
    expect(lines[2]).toMatch(
      /^C5\s+apps\/client\/wrangler\.jsonc\s+workers_dev\s+true\s+false$/,
    );
  });

  test('読み込めないファイルと解析できない資源一覧・Wrangler設定は、違反の表の代わりに入力の誤りとして出して終了コード1を返す', async () => {
    const texts = withoutPath(
      editText(validTexts(), wranglerFileOf('api'), (text) =>
        text.replace('{', '['),
      ),
      PROD_CATALOG,
    );

    const { code, readPaths, stderr, summaries } = await runWith(texts);

    expect(code).toBe(EXIT_FAILURE);
    expect(readPaths).not.toContain(PROD_BACKEND);
    const lines = stderr.text().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('構成検査: 検査の入力を読み込めません。');
    expect(lines[1]).toMatch(
      /^- apps\/api\/wrangler\.jsonc: JSONCとして解析できません\(.+\)$/,
    );
    expect(lines[2]).toBe(
      `- ${PROD_CATALOG}を読み込めませんでした: ENOENT: no such file`,
    );
    expect(summaries()[0]).toContain('検査の入力を読み込めません。');
    expect(summaries()[0]).toContain('- apps/api/wrangler.jsonc: ');
  });

  test('JSONでない資源一覧と、項目の誤りがある資源一覧を、ファイルのパスを付けて出す', async () => {
    const texts = {
      ...validTexts(),
      [STAGING_CATALOG]: '{',
      [PROD_CATALOG]: JSON.stringify({
        ...prodCatalogJson(),
        jurisdiction: 'eu',
      }),
    };

    const { code, stderr } = await runWith(texts);

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toContain(
      `- ${STAGING_CATALOG}: JSONとして解析できません(`,
    );
    expect(stderr.text()).toContain(
      `- ${PROD_CATALOG}: jurisdiction: "us"のいずれかが必要です(実際: "eu")`,
    );
  });

  test('引数を受け取らない', async () => {
    const files = createFakeRepoFiles(validTexts());

    const message = await rejectionMessageOf(
      command.run(['--env', 'staging'], createFakeDeps(files).deps),
    );

    expect(message).toBe('引数は受け取りません: --env staging');
  });
});
