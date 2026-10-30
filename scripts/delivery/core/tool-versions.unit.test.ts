import { describe, expect, test } from 'bun:test';

import {
  DOCKERFILE,
  EXPECTED_VERSIONS,
  LIVE_VERSIONS_TF,
  ROOT_PACKAGE_JSON,
  replaceOnce,
} from '../test-fixtures/workflows.ts';
import {
  dockerfileToolVersion,
  readExpectedToolVersions,
  toolVersionsInEnv,
  toolVersionsInStep,
} from './tool-versions.ts';

const validInput = (): Parameters<typeof readExpectedToolVersions>[0] => ({
  dockerfile: DOCKERFILE,
  liveVersionsTf: LIVE_VERSIONS_TF,
  rootPackageJson: ROOT_PACKAGE_JSON,
});

const errorsOf = (
  patch: Partial<Parameters<typeof readExpectedToolVersions>[0]>,
): readonly string[] => {
  const result = readExpectedToolVersions({ ...validInput(), ...patch });
  return result.ok ? [] : result.errors;
};

describe('readExpectedToolVersions', () => {
  test('Dockerfile・ルートモジュールの版の指定・ルートのpackage.jsonから期待する版を読む', () => {
    expect(readExpectedToolVersions(validInput())).toEqual({
      ok: true,
      versions: EXPECTED_VERSIONS,
    });
  });

  test('Bunのイメージのタグから派生の名前を除き、引用符で囲んだ値も読む', () => {
    const dockerfile = replaceOnce(
      replaceOnce(
        DOCKERFILE,
        'BUN_IMAGE_TAG=1.4.4-slim',
        'BUN_IMAGE_TAG="1.4.5-alpine"',
      ),
      'NODE_VERSION=26.12.1',
      "NODE_VERSION='26.12.2'",
    );

    const result = readExpectedToolVersions({ ...validInput(), dockerfile });

    expect(result.ok && result.versions).toEqual({
      ...EXPECTED_VERSIONS,
      bun: '1.4.5',
      node: '26.12.2',
    });
  });

  test('Dockerfileに無い版の引数を誤りとして返す', () => {
    const dockerfile = replaceOnce(
      DOCKERFILE,
      'ARG MAILPIT_VERSION=1.32.0\n',
      '',
    );

    expect(errorsOf({ dockerfile })).toEqual([
      'DockerfileにARG MAILPIT_VERSIONがありません',
    ]);
  });

  test('完全に固定していない版と、同じ引数の食い違う既定値を誤りとして返す', () => {
    const dockerfile = `${replaceOnce(
      replaceOnce(DOCKERFILE, 'BUN_IMAGE_TAG=1.4.4-slim', 'BUN_IMAGE_TAG=1'),
      'WRANGLER_VERSION=4.152.0',
      'WRANGLER_VERSION=latest',
    )}ARG NODE_VERSION=24.0.0\n`;

    expect(errorsOf({ dockerfile })).toEqual([
      'DockerfileのARG NODE_VERSIONの既定値が食い違っています: 26.12.1・24.0.0',
      'DockerfileのARG BUN_IMAGE_TAGが完全に固定した版ではありません: 1',
      'DockerfileのARG WRANGLER_VERSIONが完全に固定した版ではありません: latest',
    ]);
  });

  test('ルートモジュールのrequired_versionの欠落とOpenTofuの版との食い違いを誤りとして返す', () => {
    expect(
      errorsOf({
        liveVersionsTf: replaceOnce(
          LIVE_VERSIONS_TF,
          '  required_version = "1.13.2"\n',
          '',
        ),
      }),
    ).toEqual(['apps/infra/live/versions.tfにrequired_versionがありません']);
    expect(
      errorsOf({
        liveVersionsTf: replaceOnce(LIVE_VERSIONS_TF, '"1.13.2"', '">= 1.13"'),
      }),
    ).toEqual([
      'apps/infra/live/versions.tfのrequired_version(>= 1.13)がDockerfileのOPENTOFU_VERSION(1.13.2)と一致しません',
    ]);
  });

  test('ルートのpackage.jsonの@playwright/testの欠落とPlaywrightの版との食い違いを誤りとして返す', () => {
    expect(
      errorsOf({
        rootPackageJson: JSON.stringify({ devDependencies: {} }),
      }),
    ).toEqual(['package.jsonに@playwright/testがありません']);
    expect(
      errorsOf({
        rootPackageJson: JSON.stringify({
          dependencies: { '@playwright/test': '^1.64.1' },
        }),
      }),
    ).toEqual([
      'package.jsonの@playwright/test(^1.64.1)がDockerfileのPLAYWRIGHT_VERSION(1.64.1)と一致しません',
    ]);
  });

  test('JSONとして読めないpackage.jsonを誤りとして返す', () => {
    expect(errorsOf({ rootPackageJson: '{' })).toEqual([
      'package.jsonをJSONとして読めません',
    ]);
  });
});

describe('dockerfileToolVersion', () => {
  test('Dockerfileから1つのツールの版だけを読む', () => {
    expect(dockerfileToolVersion(DOCKERFILE, 'wranglerTool')).toEqual({
      ok: true,
      version: '4.152.0',
    });
  });

  test('ほかのツールの版の誤りは、そのツールの版の読み取りに影響しない', () => {
    const dockerfile = replaceOnce(
      DOCKERFILE,
      'ARG MAILPIT_VERSION=1.32.0\n',
      'ARG MAILPIT_VERSION=latest\n',
    );

    expect(dockerfileToolVersion(dockerfile, 'wranglerTool')).toEqual({
      ok: true,
      version: '4.152.0',
    });
  });

  test.each([
    [
      'ARG WRANGLER_VERSION=4.152.0\n',
      '',
      'DockerfileにARG WRANGLER_VERSIONがありません',
    ],
    [
      'WRANGLER_VERSION=4.152.0',
      'WRANGLER_VERSION=latest',
      'DockerfileのARG WRANGLER_VERSIONが完全に固定した版ではありません: latest',
    ],
    [
      'ARG PLAYWRIGHT_VERSION=1.64.1\n',
      'ARG PLAYWRIGHT_VERSION=1.64.1\nARG WRANGLER_VERSION=4.153.0\n',
      'DockerfileのARG WRANGLER_VERSIONの既定値が食い違っています: 4.152.0・4.153.0',
    ],
  ])('%pを%pに変えると、誤りを返す', (search, replacement, error) => {
    const dockerfile = replaceOnce(DOCKERFILE, search, replacement);

    expect(dockerfileToolVersion(dockerfile, 'wranglerTool')).toEqual({
      ok: false,
      error,
    });
  });
});

describe('toolVersionsInStep', () => {
  test('setupのアクションの版の入力を読み、入力の欠落を空の版として返す', () => {
    expect(
      toolVersionsInStep({
        uses: 'oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76',
        with: { 'bun-version': '1.4.4' },
      }),
    ).toEqual([{ tool: 'bun', key: 'with.bun-version', value: '1.4.4' }]);
    expect(
      toolVersionsInStep({ uses: 'actions/setup-node@v4', with: {} }),
    ).toEqual([{ tool: 'node', key: 'with.node-version', value: '' }]);
    expect(
      toolVersionsInStep({
        uses: 'opentofu/setup-opentofu@v1',
        with: { tofu_version: 1.1 },
      }),
    ).toEqual([{ tool: 'opentofu', key: 'with.tofu_version', value: '1.1' }]);
  });

  test('手順の環境変数とrunのパッケージの版の指定を読み、変数の参照は読まない', () => {
    expect(
      toolVersionsInStep({
        env: { MAILPIT_VERSION: '1.32.0', OTHER: 'x' },
        run: [
          'bun add -g "wrangler@4.152.0"',
          'bunx playwright@1.64.0 install chromium',
          'bun add -d @playwright/test@latest',
          'bun add -g "wrangler@${WRANGLER_VERSION}"',
        ].join('\n'),
      }),
    ).toEqual([
      { tool: 'mailpit', key: 'env.MAILPIT_VERSION', value: '1.32.0' },
      { tool: 'wranglerTool', key: 'run', value: '4.152.0' },
      { tool: 'playwright', key: 'run', value: '1.64.0' },
      { tool: 'playwright', key: 'run', value: 'latest' },
    ]);
  });

  test('版に関わらない手順と、手順でない値からは何も読まない', () => {
    expect(
      toolVersionsInStep({ uses: './.github/actions/setup-toolchain' }),
    ).toEqual([]);
    expect(toolVersionsInStep('run')).toEqual([]);
  });
});

describe('toolVersionsInEnv', () => {
  test('Dockerfileと同じ名前の環境変数から版を読む', () => {
    expect(
      toolVersionsInEnv({
        BUN_VERSION: '1.4.4',
        NODE_VERSION: '26.12.1',
        OPENTOFU_VERSION: '1.13.2',
        INFISICAL_CLI_VERSION: '0.44.8',
        WRANGLER_VERSION: '4.152.0',
        MAILPIT_VERSION: '1.32.0',
        PLAYWRIGHT_VERSION: '1.64.1',
        LOG_LEVEL: 'info',
      }),
    ).toEqual([
      { tool: 'bun', key: 'env.BUN_VERSION', value: '1.4.4' },
      { tool: 'node', key: 'env.NODE_VERSION', value: '26.12.1' },
      { tool: 'opentofu', key: 'env.OPENTOFU_VERSION', value: '1.13.2' },
      {
        tool: 'infisicalCli',
        key: 'env.INFISICAL_CLI_VERSION',
        value: '0.44.8',
      },
      { tool: 'wranglerTool', key: 'env.WRANGLER_VERSION', value: '4.152.0' },
      { tool: 'mailpit', key: 'env.MAILPIT_VERSION', value: '1.32.0' },
      { tool: 'playwright', key: 'env.PLAYWRIGHT_VERSION', value: '1.64.1' },
    ]);
    expect(toolVersionsInEnv(undefined)).toEqual([]);
  });
});
