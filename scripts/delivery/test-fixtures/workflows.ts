import type { ExpectedToolVersions } from '../core/tool-versions.ts';

export const EXPECTED_VERSIONS: ExpectedToolVersions = {
  bun: '1.4.4',
  node: '26.12.1',
  opentofu: '1.13.2',
  infisicalCli: '0.44.8',
  wranglerTool: '4.152.0',
  mailpit: '1.32.0',
  playwright: '1.64.1',
};

export const CHECKOUT_SHA = '11bd71901bbe5b1630ceea73d27597364c9af683';

const SETUP_BUN_SHA = '735343b667d3e6f658f44d0eca948eb6282f2b76';
const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020';
const SETUP_OPENTOFU_SHA = '000d5b6d4b0c8d6b7ef1d8a6e1d4f5a3c2b1a0f9';
const TRUFFLEHOG_SHA = '6c05c4a00b91aa542267d8e32a8254774799d68d';

export const SETUP_ACTION_FILE = '.github/actions/setup-toolchain/action.yml';

export const SETUP_ACTION_YAML = `name: setup-toolchain
description: CIで使うツールを導入する
inputs:
  node:
    description: Node.jsを導入する
    default: 'false'
  tofu:
    description: OpenTofuを導入する
    default: 'false'
  infisical:
    description: Infisical CLIを導入する
    default: 'false'
  wrangler-tool:
    description: 購読の操作に使うWranglerを導入する
    default: 'false'
  mailpit:
    description: Mailpitを導入する
    default: 'false'
outputs:
  mailpit-bin:
    description: Mailpitの実行ファイル
    value: \${{ steps.mailpit.outputs.bin }}
runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@${SETUP_BUN_SHA}
      with:
        bun-version: 1.4.4
    - if: inputs.node == 'true'
      uses: actions/setup-node@${SETUP_NODE_SHA}
      with:
        node-version: 26.12.1
    - if: inputs.tofu == 'true'
      uses: opentofu/setup-opentofu@${SETUP_OPENTOFU_SHA}
      with:
        tofu_version: 1.13.2
        tofu_wrapper: false
    - if: inputs.infisical == 'true'
      shell: bash
      env:
        INFISICAL_CLI_VERSION: 0.44.8
      run: |
        archive="infisical_\${INFISICAL_CLI_VERSION}_linux_amd64.tar.gz"
        curl -fsSLO "https://github.example/infisical/releases/v\${INFISICAL_CLI_VERSION}/\${archive}"
    - if: inputs.wrangler-tool == 'true'
      shell: bash
      run: bun add -g "wrangler@4.152.0"
    - if: inputs.mailpit == 'true'
      id: mailpit
      shell: bash
      env:
        MAILPIT_VERSION: 1.32.0
      run: |
        curl -fsSLO "https://github.example/mailpit/releases/v\${MAILPIT_VERSION}/mailpit-linux-amd64.tar.gz"
        echo "bin=$RUNNER_TEMP/mailpit" >> "$GITHUB_OUTPUT"
`;

const checkoutStep = (indent: string, extra = ''): string =>
  `${indent}- uses: actions/checkout@${CHECKOUT_SHA}
${indent}  with:
${indent}    persist-credentials: false${extra}`;

export const CHECKS_FILE = '.github/workflows/checks.yml';

export const CHECKS_YAML = `name: checks
on:
  workflow_call:
permissions:
  contents: read
jobs:
  secret-scan:
    runs-on: ubuntu-24.04
    steps:
${checkoutStep('      ', '\n          fetch-depth: 0')}
      - uses: trufflesecurity/trufflehog@${TRUFFLEHOG_SHA}
        with:
          extra_args: --results=verified,unknown
  quality:
    needs: secret-scan
    runs-on: ubuntu-24.04
    steps:
${checkoutStep('      ')}
      - uses: ./.github/actions/setup-toolchain
        with:
          tofu: 'true'
      - run: bun scripts/delivery/cli.ts install
      - run: bun scripts/delivery/cli.ts policy-check
  tests:
    needs: quality
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      id-token: write
    steps:
${checkoutStep('      ')}
      - uses: ./.github/actions/setup-toolchain
        with:
          node: 'true'
          infisical: 'true'
      - run: bunx playwright install --with-deps chromium
      - run: bun scripts/delivery/cli.ts infisical-login --scope checks
  e2e:
    needs: quality
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      id-token: write
    steps:
${checkoutStep('      ')}
      - uses: ./.github/actions/setup-toolchain
        with:
          node: 'true'
          infisical: 'true'
          mailpit: 'true'
      - run: bun scripts/delivery/cli.ts infisical-login --scope checks
  rehearsal:
    needs: quality
    runs-on: ubuntu-24.04
    steps:
${checkoutStep('      ')}
      - run: bun scripts/delivery/cli.ts rehearse --env staging
  ci-gate:
    if: always()
    needs: [secret-scan, quality, tests, e2e, rehearsal]
    runs-on: ubuntu-24.04
    steps:
      - env:
          RESULTS: \${{ toJSON(needs) }}
        run: bun scripts/delivery/cli.ts ci-gate
`;

export const PULL_REQUEST_FILE = '.github/workflows/pull-request.yml';

export const PULL_REQUEST_YAML = `name: pull-request
on:
  pull_request:
    branches: [main, prod]
  push:
    branches: ['hotfix/**']
permissions:
  contents: read
concurrency:
  group: pr-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  checks:
    uses: ./.github/workflows/checks.yml
    permissions:
      contents: read
      id-token: write
`;

export const DELIVERY_FILE = '.github/workflows/delivery.yml';

export const DELIVERY_YAML = `name: delivery
on:
  push:
    branches: [main, prod]
permissions:
  contents: read
jobs:
  checks:
    uses: ./.github/workflows/checks.yml
    permissions:
      contents: read
      id-token: write
  deploy:
    needs: checks
    uses: ./.github/workflows/deploy.yml
    permissions:
      contents: read
      id-token: write
    with:
      environment: \${{ github.ref_name == 'prod' && 'prod' || 'staging' }}
`;

export const DEPLOY_FILE = '.github/workflows/deploy.yml';

const STAGE_STEPS = [
  'preflight',
  'tofu-foundation',
  'reconcile-ids',
  'migrate',
  'deploy-api',
  'deploy-event',
  'deploy-client',
  'deploy-admin',
  'tofu-routing',
  'email-subscription',
  'verify',
]
  .map(
    (stage) => `      - id: ${stage}
        run: bun scripts/delivery/cli.ts ${stage} --env "$DEPLOY_ENVIRONMENT"`,
  )
  .join('\n');

export const DEPLOY_YAML = `name: deploy
on:
  workflow_call:
    inputs:
      environment:
        type: string
        required: true
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-24.04
    environment: \${{ inputs.environment }}
    permissions:
      contents: read
      id-token: write
    concurrency:
      group: deploy-\${{ inputs.environment }}
      cancel-in-progress: false
    timeout-minutes: 60
    env:
      DEPLOY_ENVIRONMENT: \${{ inputs.environment }}
    steps:
${checkoutStep('      ', '\n          fetch-depth: 0')}
      - uses: ./.github/actions/setup-toolchain
        with:
          node: 'true'
          tofu: 'true'
          infisical: 'true'
          wrangler-tool: 'true'
      - run: bun scripts/delivery/cli.ts install
${STAGE_STEPS}
`;

export const RELEASE_PR_FILE = '.github/workflows/release-pr.yml';

export const RELEASE_PR_YAML = `name: release-pr
on:
  workflow_dispatch:
    inputs:
      head:
        type: string
        default: main
permissions:
  contents: read
jobs:
  release-pr:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    steps:
${checkoutStep('      ', '\n          fetch-depth: 0')}
      - uses: ./.github/actions/setup-toolchain
      - env:
          RELEASE_HEAD: \${{ inputs.head }}
          GH_TOKEN: \${{ github.token }}
        run: bun scripts/delivery/cli.ts release-pr
`;

export const WORKFLOW_YAMLS: Readonly<Record<string, string>> = {
  [CHECKS_FILE]: CHECKS_YAML,
  [PULL_REQUEST_FILE]: PULL_REQUEST_YAML,
  [DELIVERY_FILE]: DELIVERY_YAML,
  [DEPLOY_FILE]: DEPLOY_YAML,
  [RELEASE_PR_FILE]: RELEASE_PR_YAML,
};

export const replaceOnce = (
  text: string,
  search: string,
  replacement: string,
): string => {
  if (!text.includes(search)) {
    throw new Error(`フィクスチャに置き換える文字列がありません: ${search}`);
  }
  return text.replace(search, replacement);
};

export const DOCKERFILE = `# syntax=docker/dockerfile:1
ARG BUN_IMAGE_TAG=1.4.4-slim

FROM oven/bun:\${BUN_IMAGE_TAG} AS tools-builder
ARG OPENTOFU_VERSION=1.13.2
ARG WRANGLER_VERSION=4.152.0

FROM debian:trixie-slim AS release-binaries-builder
ARG TARGETARCH
ARG MAILPIT_VERSION=1.32.0
ARG NODE_VERSION=26.12.1

FROM oven/bun:\${BUN_IMAGE_TAG}
ARG INFISICAL_CLI_VERSION=0.44.8
ARG PLAYWRIGHT_VERSION=1.64.1
`;

export const LIVE_VERSIONS_TF = `terraform {
  required_version = "1.13.2"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.27.0"
    }
  }
}
`;

export const ROOT_PACKAGE_JSON = `{
  "name": "root",
  "devDependencies": {
    "@playwright/test": "1.64.1",
    "typescript": "6.0.3"
  }
}
`;
