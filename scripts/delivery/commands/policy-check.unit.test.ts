import { describe, expect, test } from 'bun:test';

import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
  withoutPath,
} from '../test-fixtures/repo-files.ts';
import {
  CHECKOUT_SHA,
  DEPLOY_FILE,
  DOCKERFILE,
  LIVE_VERSIONS_TF,
  ROOT_PACKAGE_JSON,
  SETUP_ACTION_FILE,
  SETUP_ACTION_YAML,
  WORKFLOW_YAMLS,
  replaceOnce,
} from '../test-fixtures/workflows.ts';
import { command } from './policy-check.ts';
import { EXIT_FAILURE, EXIT_SUCCESS } from './shared/delivery-command.ts';

const VERSION_SOURCES: Readonly<Record<string, string>> = {
  Dockerfile: DOCKERFILE,
  'apps/infra/live/versions.tf': LIVE_VERSIONS_TF,
  'package.json': ROOT_PACKAGE_JSON,
};

const validTexts = (): Record<string, string> => ({
  ...WORKFLOW_YAMLS,
  [SETUP_ACTION_FILE]: SETUP_ACTION_YAML,
  ...VERSION_SOURCES,
});

const EXTRA_WORKFLOW_FILE = '.github/workflows/extra.yaml';

const EXTRA_WORKFLOW_YAML = `name: extra
on: workflow_dispatch
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/checkout@${CHECKOUT_SHA}
        with:
          persist-credentials: false
`;

const runWith = async (
  texts: Readonly<Record<string, string>>,
  args: readonly string[] = [],
) => {
  const files = createFakeRepoFiles(texts);
  const fake = createFakeDeps(files);
  const code = await command.run(args, fake.deps);
  return { ...fake, code, readPaths: files.readPaths() };
};

describe('policy-check', () => {
  test('全ワークフロー・複合アクション・版の出どころを読み、違反が無ければ終了コード0で違反が無い旨を書く', async () => {
    const { code, readPaths, stdout, stderr, summaries } = await runWith({
      ...validTexts(),
      '.github/workflows/README.md': '# ワークフロー',
    });

    expect(code).toBe(EXIT_SUCCESS);
    expect(readPaths).toEqual(
      [
        ...Object.keys(WORKFLOW_YAMLS),
        SETUP_ACTION_FILE,
        ...Object.keys(VERSION_SOURCES),
      ].toSorted(),
    );
    expect(stdout.text()).toBe('ワークフローの検査: 違反はありません。\n');
    expect(stderr.text()).toBe('');
    expect(summaries()).toEqual([
      '### ワークフローの検査\n\n違反はありません。\n',
    ]);
  });

  test('拡張子yamlのワークフローも検査し、違反を規則・ファイル・項目・実際・期待の表で出し、手順の要約にも書いて終了コード1を返す', async () => {
    const { code, stdout, stderr, summaries } = await runWith({
      ...validTexts(),
      [EXTRA_WORKFLOW_FILE]: EXTRA_WORKFLOW_YAML,
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stdout.text()).toBe('');
    const lines = stderr.text().split('\n');
    expect(lines[0]).toBe('ワークフローの検査: 違反が1件あります。');
    expect(lines[1]).toMatch(/^規則\s+ファイル\s+項目\s+実際\s+期待$/);
    expect(lines[2]).toMatch(
      /^W1\s+\.github\/workflows\/extra\.yaml\s+jobs\.lint\.steps\[0\]\.uses\s+actions\/checkout@v4\s+/,
    );
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0]).toContain(
      '| W1 | .github/workflows/extra.yaml | jobs.lint.steps[0].uses | actions/checkout@v4 |',
    );
  });

  test('ワークフローと複合アクションがまだ無ければ、必須のワークフローと版の宣言の欠落を違反として出す', async () => {
    const { code, stderr, summaries } = await runWith(VERSION_SOURCES);

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).not.toContain('検査の入力を読み込めません');
    const summary = summaries()[0] ?? '';
    expect(summary).toContain('| W7 | .github/workflows/deploy.yml |');
    expect(summary).toContain('| W8 | .github/workflows/deploy.yml |');
    expect(summary).toContain('| W10 | .github/workflows/checks.yml |');
    expect(summary).toContain(
      `| W9 | ${SETUP_ACTION_FILE} | runs.steps | (なし) | bun 1.4.4 |`,
    );
  });

  test('解析できないYAMLと読み込めない版の出どころは、違反の表の代わりに入力の誤りとして出して終了コード1を返す', async () => {
    const texts = withoutPath(
      {
        ...validTexts(),
        [DEPLOY_FILE]: replaceOnce(
          WORKFLOW_YAMLS[DEPLOY_FILE] ?? '',
          'jobs:',
          'jobs: [',
        ),
      },
      'Dockerfile',
    );

    const { code, stderr, summaries } = await runWith(texts);

    expect(code).toBe(EXIT_FAILURE);
    const lines = stderr.text().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('ワークフローの検査: 検査の入力を読み込めません。');
    expect(lines[1]).toBe(
      '- Dockerfileを読み込めませんでした: ENOENT: no such file',
    );
    expect(lines[2]).toMatch(
      /^- \.github\/workflows\/deploy\.yml: YAMLとして解析できません\(.+\)$/,
    );
    expect(summaries()[0]).toContain('検査の入力を読み込めません。');
  });

  test('Dockerfileから期待する版を読めなければ、入力の誤りとして出す', async () => {
    const { code, stderr } = await runWith({
      ...validTexts(),
      Dockerfile: replaceOnce(
        DOCKERFILE,
        'ARG PLAYWRIGHT_VERSION=1.64.1\n',
        '',
      ),
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toContain(
      '- DockerfileにARG PLAYWRIGHT_VERSIONがありません',
    );
  });

  test('引数を受け取らない', async () => {
    const files = createFakeRepoFiles(validTexts());

    const message = await rejectionMessageOf(
      command.run(['extra'], createFakeDeps(files).deps),
    );

    expect(message).toBe('引数は受け取りません: extra');
  });
});
