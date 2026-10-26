import { describe, expect, test } from 'bun:test';

import {
  type ArtifactCheck,
  compareGenerated,
  reportGeneratedChecks,
  resolverTypesCheckOf,
} from './generated-check.ts';

const WORK_DIR = 'apps/sample';

const UP_TO_DATE_CHECKS: readonly ArtifactCheck[] = [
  { artifact: 'schema', status: 'up-to-date' },
  { artifact: 'resolver-types', status: 'up-to-date' },
  { artifact: 'allowlist', status: 'up-to-date' },
];

describe('compareGenerated', () => {
  test('生成した内容とファイルの内容が同じなら最新とする', () => {
    expect(compareGenerated('schema', 'type Query\n', 'type Query\n')).toEqual({
      artifact: 'schema',
      status: 'up-to-date',
    });
  });

  test.each<[string, string | undefined]>([
    ['内容が異なる', 'type Query {\n  a: Int\n}\n'],
    ['末尾の改行だけが異なる', 'type Query'],
    ['ファイルが無い', undefined],
  ])('%s場合は古いとする', (_case, actual) => {
    expect(compareGenerated('allowlist', 'type Query\n', actual)).toEqual({
      artifact: 'allowlist',
      status: 'outdated',
    });
  });
});

describe('resolverTypesCheckOf', () => {
  test('graphql-codegenの検査が終了コード0なら最新、それ以外なら古いとする', () => {
    expect(resolverTypesCheckOf(0)).toEqual({
      artifact: 'resolver-types',
      status: 'up-to-date',
    });
    expect(resolverTypesCheckOf(1)).toEqual({
      artifact: 'resolver-types',
      status: 'outdated',
    });
  });
});

describe('reportGeneratedChecks', () => {
  test('すべて最新なら、生成物ごとの一致を標準出力に示して終了コード0にする', () => {
    expect(reportGeneratedChecks(UP_TO_DATE_CHECKS, WORK_DIR)).toEqual({
      exitCode: 0,
      stdout: [
        'スキーマファイルは登録箇所から合成したスキーマと一致しています。',
        'リゾルバの型はスキーマファイルから生成した内容と一致しています。',
        '許可リストは現行の操作の一覧から生成した内容と一致しています。',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test.each<[ArtifactCheck['artifact'], string, string]>([
    [
      'schema',
      'スキーマファイルが登録箇所から合成したスキーマと食い違っています。',
      'bun run graphql:generate',
    ],
    [
      'resolver-types',
      'リゾルバの型がスキーマファイルから生成した内容と食い違っています。',
      'bun run graphql:generate',
    ],
    [
      'allowlist',
      '許可リストが現行の操作の一覧から生成した内容と食い違っています。',
      'bun run graphql:allowlist',
    ],
  ])(
    '%sだけが古ければ、食い違いと再実行すべき生成コマンドを標準エラーに示して終了コード1にする',
    (artifact, message, command) => {
      const checks = UP_TO_DATE_CHECKS.map((check): ArtifactCheck =>
        check.artifact === artifact ? { artifact, status: 'outdated' } : check,
      );

      const report = reportGeneratedChecks(checks, WORK_DIR);

      expect(report.exitCode).toBe(1);
      expect(report.stderr).toBe(
        [
          message,
          `${WORK_DIR}で次の生成コマンドを再実行し、生成物を更新してください。`,
          `  ${command}`,
          '',
        ].join('\n'),
      );
      expect(report.stdout).not.toContain(message);
    },
  );

  test('複数の生成物が古ければ、生成コマンドを重複なく生成の順に示す', () => {
    const report = reportGeneratedChecks(
      [
        { artifact: 'allowlist', status: 'outdated' },
        { artifact: 'resolver-types', status: 'outdated' },
        { artifact: 'schema', status: 'outdated' },
      ],
      WORK_DIR,
    );

    expect(report.exitCode).toBe(1);
    expect(report.stdout).toBe('');
    expect(report.stderr).toEndWith(
      [
        `${WORK_DIR}で次の生成コマンドを再実行し、生成物を更新してください。`,
        '  bun run graphql:generate',
        '  bun run graphql:allowlist',
        '',
      ].join('\n'),
    );
  });

  test('現行の操作から許可リストを生成できなければ、理由を示して終了コード1にし、生成コマンドの再実行は促さない', () => {
    const report = reportGeneratedChecks(
      [
        { artifact: 'schema', status: 'up-to-date' },
        { artifact: 'resolver-types', status: 'up-to-date' },
        {
          artifact: 'allowlist',
          status: 'unbuildable',
          errors: [
            {
              kind: 'current_invalid',
              caller: 'client',
              documentId: 'sha256:abc',
              reasons: ['query_depth_exceeded', 'graphql_validation_failed'],
            },
            { kind: 'invalid_id', caller: 'admin', documentId: 'abc' },
          ],
        },
      ],
      WORK_DIR,
    );

    expect(report).toEqual({
      exitCode: 1,
      stdout: [
        'スキーマファイルは登録箇所から合成したスキーマと一致しています。',
        'リゾルバの型はスキーマファイルから生成した内容と一致しています。',
        '',
      ].join('\n'),
      stderr: [
        '現行の操作の一覧から許可リストを生成できません。スキーマまたは操作を直してください。',
        '  現行の操作がスキーマまたは上限の検証に通りません(query_depth_exceeded・graphql_validation_failed): client sha256:abc',
        '  識別子の形式が正しくありません: admin abc',
        '',
      ].join('\n'),
    });
  });
});
