import { describe, expect, test } from 'bun:test';

import type { GithubActionsIo } from '../../adapters/github-actions.ts';
import type { ContractViolation } from '../../core/violation.ts';
import { createRecordingOutput } from '../../test-fixtures/text-output.ts';
import { EXIT_FAILURE, EXIT_SUCCESS } from './delivery-command.ts';
import { reportInputErrors, reportViolations } from './report-violations.ts';

const VIOLATION: ContractViolation = {
  rule: 'C5',
  file: 'apps/client/wrangler.jsonc',
  path: 'env.staging.workers_dev',
  actual: 'true',
  expected: 'false',
};

const createDeps = () => {
  const summaries: string[] = [];
  const github: GithubActionsIo = {
    mask: () => undefined,
    exportEnv: () => undefined,
    summary: (markdown) => {
      summaries.push(markdown);
    },
    oidcToken: () => Promise.resolve(''),
  };
  return {
    deps: {
      stdout: createRecordingOutput(),
      stderr: createRecordingOutput(),
      github,
    },
    summaries,
  };
};

describe('reportViolations', () => {
  test('違反があれば表を標準エラー出力へ、同じ内容を手順の要約へ書き、終了コード1を返す', () => {
    const { deps, summaries } = createDeps();

    const code = reportViolations('構成検査', [VIOLATION], deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(deps.stderr.text()).toContain('構成検査: 違反が1件あります。');
    expect(deps.stderr.text()).toContain('env.staging.workers_dev');
    expect(deps.stdout.text()).toBe('');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain(
      '| C5 | apps/client/wrangler.jsonc | env.staging.workers_dev | true | false |',
    );
  });

  test('違反が無ければ違反が無い旨を標準出力へ、手順の要約へ書き、終了コード0を返す', () => {
    const { deps, summaries } = createDeps();

    const code = reportViolations('構成検査', [], deps);

    expect(code).toBe(EXIT_SUCCESS);
    expect(deps.stdout.text()).toBe('構成検査: 違反はありません。\n');
    expect(deps.stderr.text()).toBe('');
    expect(summaries).toEqual(['### 構成検査\n\n違反はありません。\n']);
  });
});

describe('reportInputErrors', () => {
  test('読み込めない入力の一覧を標準エラー出力へ、同じ内容を手順の要約へ書き、終了コード1を返す', () => {
    const { deps, summaries } = createDeps();
    const errors = [
      'apps/api/wrangler.jsonc: JSONCとして解析できません',
      'apps/infra/environments/prod.json: cloudflare.accountId: 文字列が必要です',
    ];

    const code = reportInputErrors('構成検査', errors, deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(deps.stderr.text()).toBe(
      [
        '構成検査: 検査の入力を読み込めません。',
        '- apps/api/wrangler.jsonc: JSONCとして解析できません',
        '- apps/infra/environments/prod.json: cloudflare.accountId: 文字列が必要です',
        '',
      ].join('\n'),
    );
    expect(deps.stdout.text()).toBe('');
    expect(summaries).toEqual([
      [
        '### 構成検査',
        '',
        '検査の入力を読み込めません。',
        '',
        '- apps/api/wrangler.jsonc: JSONCとして解析できません',
        '- apps/infra/environments/prod.json: cloudflare.accountId: 文字列が必要です',
        '',
      ].join('\n'),
    ]);
  });
});
