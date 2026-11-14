import { describe, expect, test } from 'bun:test';

import {
  CHECKOUT_SHA,
  CHECKS_FILE,
  DELIVERY_FILE,
  DEPLOY_FILE,
  DEPLOY_YAML,
  EXPECTED_VERSIONS,
  PULL_REQUEST_FILE,
  RELEASE_PR_FILE,
  SETUP_ACTION_FILE,
  SETUP_ACTION_YAML,
  WORKFLOW_YAMLS,
  replaceOnce,
} from '../test-fixtures/workflows.ts';
import { DEPLOY_STAGES } from './deploy-stages.ts';
import type { ContractViolation } from './violation.ts';
import {
  type WorkflowDocument,
  type WorkflowPolicyInput,
  checkWorkflowPolicy,
} from './workflow-policy.ts';

const documentOf = (file: string, yaml: string): WorkflowDocument => ({
  file,
  parsed: Bun.YAML.parse(yaml),
});

const inputOf = (
  overrides: Readonly<Record<string, string | undefined>> = {},
  setupActionYaml = SETUP_ACTION_YAML,
): WorkflowPolicyInput => ({
  workflows: Object.entries({ ...WORKFLOW_YAMLS, ...overrides }).flatMap(
    ([file, yaml]) => (yaml === undefined ? [] : [documentOf(file, yaml)]),
  ),
  setupAction: documentOf(SETUP_ACTION_FILE, setupActionYaml),
  versions: EXPECTED_VERSIONS,
});

const violationsWith = (
  file: string,
  edit: (yaml: string) => string,
): readonly ContractViolation[] => {
  const yaml = WORKFLOW_YAMLS[file] ?? '';
  return checkWorkflowPolicy(inputOf({ [file]: edit(yaml) }));
};

const violation = (
  rule: string,
  file: string,
  path: string,
  actual: string,
  expected: string,
): ContractViolation => ({ rule, file, path, actual, expected });

const SHA_EXPECTED = '40桁のコミットSHAで固定した参照';

describe('checkWorkflowPolicy', () => {
  test('設計どおりのワークフローと複合アクションには違反を返さない', () => {
    expect(checkWorkflowPolicy(inputOf())).toEqual([]);
  });

  test('W1: タグやブランチで参照した外部のアクションと再利用ワークフローを違反として返す', () => {
    const workflow = `name: other
on: push
permissions: {}
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: docker://alpine:3
  reuse:
    uses: example/workflows/.github/workflows/build.yml@main
`;
    const action = replaceOnce(
      SETUP_ACTION_YAML,
      'oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76',
      'oven-sh/setup-bun@735343b',
    );

    expect(
      checkWorkflowPolicy(
        inputOf({ '.github/workflows/other.yml': workflow }, action),
      ),
    ).toEqual([
      violation(
        'W1',
        '.github/workflows/other.yml',
        'jobs.build.steps[0].uses',
        'actions/checkout@v4',
        SHA_EXPECTED,
      ),
      violation(
        'W1',
        '.github/workflows/other.yml',
        'jobs.build.steps[1].uses',
        'docker://alpine:3',
        SHA_EXPECTED,
      ),
      violation(
        'W1',
        '.github/workflows/other.yml',
        'jobs.reuse.uses',
        'example/workflows/.github/workflows/build.yml@main',
        SHA_EXPECTED,
      ),
      violation(
        'W1',
        SETUP_ACTION_FILE,
        'runs.steps[0].uses',
        'oven-sh/setup-bun@735343b',
        SHA_EXPECTED,
      ),
    ]);
  });

  test('W2: 最上位のpermissionsの欠落と、contents: readを超える権限を違反として返す', () => {
    expect(
      violationsWith(CHECKS_FILE, (yaml) =>
        replaceOnce(yaml, 'permissions:\n  contents: read\njobs:', 'jobs:'),
      ),
    ).toEqual([
      violation(
        'W2',
        CHECKS_FILE,
        'permissions',
        '',
        'contents: read以下の権限',
      ),
    ]);
    expect(
      violationsWith(PULL_REQUEST_FILE, (yaml) =>
        replaceOnce(
          yaml,
          'permissions:\n  contents: read\nconcurrency',
          'permissions:\n  contents: read\n  issues: write\n  packages: read\n  statuses: none\nconcurrency',
        ),
      ),
    ).toEqual([
      violation('W2', PULL_REQUEST_FILE, 'permissions.issues', 'write', 'none'),
      violation(
        'W2',
        PULL_REQUEST_FILE,
        'permissions.packages',
        'read',
        'none',
      ),
    ]);
    expect(
      violationsWith(RELEASE_PR_FILE, (yaml) =>
        replaceOnce(
          yaml,
          'permissions:\n  contents: read\njobs:',
          'permissions: read-all\njobs:',
        ),
      ),
    ).toEqual([
      violation(
        'W2',
        RELEASE_PR_FILE,
        'permissions',
        'read-all',
        'contents: read以下の権限',
      ),
    ]);
  });

  test('W2: contentsの書き込みを違反として返し、空の権限とcontentsのnoneは許す', () => {
    expect(
      violationsWith(DELIVERY_FILE, (yaml) =>
        replaceOnce(
          yaml,
          'permissions:\n  contents: read\njobs:',
          'permissions:\n  contents: write\njobs:',
        ),
      ),
    ).toEqual([
      violation('W2', DELIVERY_FILE, 'permissions.contents', 'write', 'read'),
    ]);
    expect(
      violationsWith(DELIVERY_FILE, (yaml) =>
        replaceOnce(
          yaml,
          'permissions:\n  contents: read\njobs:',
          'permissions:\n  contents: none\njobs:',
        ),
      ),
    ).toEqual([]);
  });

  test('W3: 設計の表に無いジョブのid-tokenの書き込みを違反として返す', () => {
    expect(
      violationsWith(CHECKS_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '  rehearsal:\n    needs: quality\n    runs-on: ubuntu-24.04\n',
          '  rehearsal:\n    needs: quality\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n      id-token: write\n',
        ),
      ),
    ).toEqual([
      violation(
        'W3',
        CHECKS_FILE,
        'jobs.rehearsal.permissions.id-token',
        'write',
        'none',
      ),
    ]);
  });

  test('W3・W4: ジョブのwrite-allを、id-token・pull-requests・contents・actionsの書き込みとして返す', () => {
    expect(
      violationsWith(RELEASE_PR_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '    permissions:\n      contents: read\n      pull-requests: write\n',
          '    permissions: write-all\n',
        ),
      ),
    ).toEqual([
      violation(
        'W3',
        RELEASE_PR_FILE,
        'jobs.release-pr.permissions.id-token',
        'write',
        'none',
      ),
      violation(
        'W4',
        RELEASE_PR_FILE,
        'jobs.release-pr.permissions.contents',
        'write',
        'read',
      ),
      violation(
        'W4',
        RELEASE_PR_FILE,
        'jobs.release-pr.permissions.actions',
        'write',
        'none',
      ),
    ]);
  });

  test('W4: release-pr以外のpull-requestsの書き込みと、ジョブのcontents・actionsの書き込みを違反として返す', () => {
    expect(
      violationsWith(DEPLOY_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '      id-token: write\n    concurrency',
          '      id-token: write\n      pull-requests: write\n      actions: write\n    concurrency',
        ),
      ),
    ).toEqual([
      violation(
        'W4',
        DEPLOY_FILE,
        'jobs.deploy.permissions.pull-requests',
        'write',
        'none',
      ),
      violation(
        'W4',
        DEPLOY_FILE,
        'jobs.deploy.permissions.actions',
        'write',
        'none',
      ),
    ]);
    expect(
      violationsWith(CHECKS_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '      contents: read\n      id-token: write\n    steps:',
          '      contents: write\n      id-token: write\n    steps:',
        ),
      ),
    ).toEqual([
      violation(
        'W4',
        CHECKS_FILE,
        'jobs.tests.permissions.contents',
        'write',
        'read',
      ),
    ]);
  });

  test('W5: pull_request_target・workflow_runの起動を違反として返す', () => {
    expect(
      violationsWith(PULL_REQUEST_FILE, (yaml) =>
        replaceOnce(yaml, '  pull_request:\n', '  pull_request_target:\n'),
      ),
    ).toEqual([
      violation(
        'W5',
        PULL_REQUEST_FILE,
        'on.pull_request_target',
        'pull_request_target',
        'pull_request_targetとworkflow_runを使わない',
      ),
    ]);
    const listed = `name: listed
on: [push, workflow_run]
permissions: {}
jobs: {}
`;
    const single = `name: single
on: workflow_run
permissions: {}
jobs: {}
`;
    expect(
      checkWorkflowPolicy(
        inputOf({
          '.github/workflows/listed.yml': listed,
          '.github/workflows/single.yml': single,
        }),
      ),
    ).toEqual([
      violation(
        'W5',
        '.github/workflows/listed.yml',
        'on.workflow_run',
        'workflow_run',
        'pull_request_targetとworkflow_runを使わない',
      ),
      violation(
        'W5',
        '.github/workflows/single.yml',
        'on.workflow_run',
        'workflow_run',
        'pull_request_targetとworkflow_runを使わない',
      ),
    ]);
  });

  test('W5: persist-credentials: falseの無いチェックアウトを違反として返す', () => {
    expect(
      violationsWith(RELEASE_PR_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '          persist-credentials: false\n',
          '          persist-credentials: true\n',
        ),
      ),
    ).toEqual([
      violation(
        'W5',
        RELEASE_PR_FILE,
        'jobs.release-pr.steps[0].with.persist-credentials',
        'true',
        'false',
      ),
    ]);
    expect(
      violationsWith(CHECKS_FILE, (yaml) =>
        replaceOnce(
          yaml,
          `      - uses: actions/checkout@${CHECKOUT_SHA}\n        with:\n          persist-credentials: false\n          fetch-depth: 0\n`,
          `      - uses: actions/checkout@${CHECKOUT_SHA}\n`,
        ),
      ),
    ).toEqual([
      violation(
        'W5',
        CHECKS_FILE,
        'jobs.secret-scan.steps[0].with.persist-credentials',
        '',
        'false',
      ),
    ]);
  });

  test('W6: runの中の入力・イベント・head_refの直接の展開を違反として返す', () => {
    expect(
      violationsWith(RELEASE_PR_FILE, (yaml) =>
        replaceOnce(
          yaml,
          'run: bun scripts/delivery/cli.ts release-pr',
          'run: bun scripts/delivery/cli.ts release-pr --head "${{ inputs.head }}" --title "${{github.event.pull_request.title}}" --ref ${{ github.head_ref }} --sha ${{ github.sha }}',
        ),
      ),
    ).toEqual([
      violation(
        'W6',
        RELEASE_PR_FILE,
        'jobs.release-pr.steps[2].run',
        '${{ inputs.head }}',
        '環境変数を経由した参照',
      ),
      violation(
        'W6',
        RELEASE_PR_FILE,
        'jobs.release-pr.steps[2].run',
        '${{github.event.pull_request.title}}',
        '環境変数を経由した参照',
      ),
      violation(
        'W6',
        RELEASE_PR_FILE,
        'jobs.release-pr.steps[2].run',
        '${{ github.head_ref }}',
        '環境変数を経由した参照',
      ),
    ]);
    const action = replaceOnce(
      SETUP_ACTION_YAML,
      'run: bun add -g "wrangler@4.152.0"',
      'run: bun add -g "wrangler@4.152.0" && echo "${{ inputs.node }}"',
    );
    expect(checkWorkflowPolicy(inputOf({}, action))).toEqual([
      violation(
        'W6',
        SETUP_ACTION_FILE,
        'runs.steps[4].run',
        '${{ inputs.node }}',
        '環境変数を経由した参照',
      ),
    ]);
  });

  test('W7: deployジョブの環境と直列化の欠落・食い違いを違反として返す', () => {
    expect(
      violationsWith(DEPLOY_FILE, (yaml) =>
        replaceOnce(
          replaceOnce(
            yaml,
            '    environment: ${{ inputs.environment }}\n',
            '    environment: staging\n',
          ),
          '      cancel-in-progress: false\n',
          '      cancel-in-progress: true\n',
        ),
      ),
    ).toEqual([
      violation(
        'W7',
        DEPLOY_FILE,
        'jobs.deploy.environment',
        'staging',
        '${{ inputs.environment }}',
      ),
      violation(
        'W7',
        DEPLOY_FILE,
        'jobs.deploy.concurrency.cancel-in-progress',
        'true',
        'false',
      ),
    ]);
    expect(
      violationsWith(DEPLOY_FILE, (yaml) =>
        replaceOnce(
          replaceOnce(
            yaml,
            '    environment: ${{ inputs.environment }}\n',
            '    environment:\n      name: ${{inputs.environment}}\n',
          ),
          '    concurrency:\n      group: deploy-${{ inputs.environment }}\n      cancel-in-progress: false\n',
          '',
        ),
      ),
    ).toEqual([
      violation(
        'W7',
        DEPLOY_FILE,
        'jobs.deploy.concurrency.group',
        '',
        'deploy-${{ inputs.environment }}',
      ),
      violation(
        'W7',
        DEPLOY_FILE,
        'jobs.deploy.concurrency.cancel-in-progress',
        '',
        'false',
      ),
    ]);
  });

  test('W7・W8: deploy.ymlのdeployジョブが無ければ違反として返す', () => {
    expect(
      violationsWith(DEPLOY_FILE, (yaml) =>
        replaceOnce(yaml, '  deploy:\n', '  release:\n'),
      ),
    ).toEqual([
      violation(
        'W3',
        DEPLOY_FILE,
        'jobs.release.permissions.id-token',
        'write',
        'none',
      ),
      violation('W7', DEPLOY_FILE, 'jobs.deploy', 'なし', 'あり'),
      violation('W8', DEPLOY_FILE, 'jobs.deploy', 'なし', 'あり'),
    ]);
    expect(checkWorkflowPolicy(inputOf({ [DEPLOY_FILE]: undefined }))).toEqual([
      violation('W7', DEPLOY_FILE, '', 'なし', 'あり'),
      violation('W8', DEPLOY_FILE, '', 'なし', 'あり'),
    ]);
  });

  test('W8: デプロイの段階の順の入れ替えと、段階でないidを違反として返す', () => {
    const swapped = replaceOnce(
      replaceOnce(DEPLOY_YAML, '- id: deploy-api', '- id: deploy-tmp'),
      '- id: deploy-event',
      '- id: deploy-api',
    ).replace('- id: deploy-tmp', '- id: deploy-event');
    const expected = DEPLOY_STAGES.join('→');

    expect(checkWorkflowPolicy(inputOf({ [DEPLOY_FILE]: swapped }))).toEqual([
      violation(
        'W8',
        DEPLOY_FILE,
        'jobs.deploy.steps[].id',
        expected.replace('deploy-api→deploy-event', 'deploy-event→deploy-api'),
        expected,
      ),
    ]);
    expect(
      violationsWith(DEPLOY_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '      - run: bun scripts/delivery/cli.ts install\n',
          '      - id: install\n        run: bun scripts/delivery/cli.ts install\n',
        ),
      ),
    ).toEqual([
      violation(
        'W8',
        DEPLOY_FILE,
        'jobs.deploy.steps[].id',
        `install→${expected}`,
        expected,
      ),
    ]);
  });

  test('W9: 複合アクションのツールの版の不一致と欠落を違反として返す', () => {
    const action = replaceOnce(
      replaceOnce(
        replaceOnce(
          SETUP_ACTION_YAML,
          'bun-version: 1.4.4',
          'bun-version: 1.4.3',
        ),
        'INFISICAL_CLI_VERSION: 0.44.8',
        'INFISICAL_CLI_VERSION: 0.44.7',
      ),
      '        MAILPIT_VERSION: 1.32.0\n',
      '        MAILPIT_RELEASE: 1.32.0\n',
    );

    expect(checkWorkflowPolicy(inputOf({}, action))).toEqual([
      violation(
        'W9',
        SETUP_ACTION_FILE,
        'runs.steps[0].with.bun-version',
        '1.4.3',
        '1.4.4',
      ),
      violation(
        'W9',
        SETUP_ACTION_FILE,
        'runs.steps[3].env.INFISICAL_CLI_VERSION',
        '0.44.7',
        '0.44.8',
      ),
      violation('W9', SETUP_ACTION_FILE, 'runs.steps', '', 'mailpit 1.32.0'),
    ]);
  });

  test('W9: ワークフローの環境変数とrunのツールの版の不一致を違反として返す', () => {
    expect(
      violationsWith(CHECKS_FILE, (yaml) =>
        replaceOnce(
          replaceOnce(
            yaml,
            'permissions:\n  contents: read\njobs:',
            'permissions:\n  contents: read\nenv:\n  NODE_VERSION: 24.0.0\njobs:',
          ),
          'run: bunx playwright install --with-deps chromium',
          'run: bunx playwright@1.60.0 install --with-deps chromium',
        ),
      ),
    ).toEqual([
      violation('W9', CHECKS_FILE, 'env.NODE_VERSION', '24.0.0', '26.12.1'),
      violation(
        'W9',
        CHECKS_FILE,
        'jobs.tests.steps[2].run',
        '1.60.0',
        '1.64.1',
      ),
    ]);
    expect(
      violationsWith(DEPLOY_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '      DEPLOY_ENVIRONMENT: ${{ inputs.environment }}\n',
          '      DEPLOY_ENVIRONMENT: ${{ inputs.environment }}\n      WRANGLER_VERSION: 4.151.0\n',
        ),
      ),
    ).toEqual([
      violation(
        'W9',
        DEPLOY_FILE,
        'jobs.deploy.env.WRANGLER_VERSION',
        '4.151.0',
        '4.152.0',
      ),
    ]);
  });

  test('W10: ci-gateのneedsの不足とif: always()の欠落を違反として返す', () => {
    expect(
      violationsWith(CHECKS_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '    if: always()\n    needs: [secret-scan, quality, tests, e2e, rehearsal]\n',
          '    if: success()\n    needs: [quality, tests, e2e]\n',
        ),
      ),
    ).toEqual([
      violation(
        'W10',
        CHECKS_FILE,
        'jobs.ci-gate.needs',
        'quality・tests・e2e',
        'secret-scan・quality・tests・e2e・rehearsal',
      ),
      violation('W10', CHECKS_FILE, 'jobs.ci-gate.if', 'success()', 'always()'),
    ]);
    expect(
      violationsWith(CHECKS_FILE, (yaml) =>
        replaceOnce(
          yaml,
          '    if: always()\n    needs: [secret-scan, quality, tests, e2e, rehearsal]\n',
          '    if: ${{ always() }}\n    needs: quality\n',
        ),
      ),
    ).toEqual([
      violation(
        'W10',
        CHECKS_FILE,
        'jobs.ci-gate.needs',
        'quality',
        'secret-scan・quality・tests・e2e・rehearsal',
      ),
    ]);
  });

  test('W10: checks.ymlとci-gateジョブが無ければ違反として返す', () => {
    expect(
      violationsWith(CHECKS_FILE, (yaml) =>
        replaceOnce(yaml, '  ci-gate:\n', '  gate:\n'),
      ),
    ).toEqual([violation('W10', CHECKS_FILE, 'jobs.ci-gate', 'なし', 'あり')]);
    expect(checkWorkflowPolicy(inputOf({ [CHECKS_FILE]: undefined }))).toEqual([
      violation('W10', CHECKS_FILE, '', 'なし', 'あり'),
    ]);
  });

  test('ワークフローの形でない値は、最上位の権限の欠落とdeployジョブの欠落として返す', () => {
    expect(
      checkWorkflowPolicy(
        inputOf({
          [DELIVERY_FILE]: '- not-a-workflow\n',
          [DEPLOY_FILE]: 'jobs: []\npermissions:\n  contents: read\n',
        }),
      ),
    ).toEqual([
      violation(
        'W2',
        DELIVERY_FILE,
        'permissions',
        '',
        'contents: read以下の権限',
      ),
      violation('W7', DEPLOY_FILE, 'jobs.deploy', 'なし', 'あり'),
      violation('W8', DEPLOY_FILE, 'jobs.deploy', 'なし', 'あり'),
    ]);
  });
});
