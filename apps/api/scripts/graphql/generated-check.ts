import {
  type AllowlistBuildError,
  describeBuildError,
} from './allowlist-builder.ts';

export type GeneratedArtifact = 'schema' | 'resolver-types' | 'allowlist';

export type ArtifactCheck =
  | {
      readonly artifact: GeneratedArtifact;
      readonly status: 'up-to-date' | 'outdated';
    }
  | {
      readonly artifact: 'allowlist';
      readonly status: 'unbuildable';
      readonly errors: readonly AllowlistBuildError[];
    };

export interface CheckReport {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

interface ArtifactMessages {
  readonly upToDate: string;
  readonly outdated: string;
  readonly regenerateCommand: string;
}

const GENERATE_COMMAND = 'bun run graphql:generate';

const ALLOWLIST_COMMAND = 'bun run graphql:allowlist';

// 許可リストの検証は合成したスキーマを使うため、スキーマと型の生成を先に再実行させる
const REGENERATE_ORDER = [GENERATE_COMMAND, ALLOWLIST_COMMAND];

const ARTIFACT_MESSAGES = {
  schema: {
    upToDate:
      'スキーマファイルは登録箇所から合成したスキーマと一致しています。',
    outdated:
      'スキーマファイルが登録箇所から合成したスキーマと食い違っています。',
    regenerateCommand: GENERATE_COMMAND,
  },
  'resolver-types': {
    upToDate:
      'リゾルバの型はスキーマファイルから生成した内容と一致しています。',
    outdated:
      'リゾルバの型がスキーマファイルから生成した内容と食い違っています。',
    regenerateCommand: GENERATE_COMMAND,
  },
  allowlist: {
    upToDate: '許可リストは現行の操作の一覧から生成した内容と一致しています。',
    outdated:
      '許可リストが現行の操作の一覧から生成した内容と食い違っています。',
    regenerateCommand: ALLOWLIST_COMMAND,
  },
} as const satisfies Record<GeneratedArtifact, ArtifactMessages>;

const UNBUILDABLE_MESSAGE =
  '現行の操作の一覧から許可リストを生成できません。スキーマまたは操作を直してください。';

export function compareGenerated(
  artifact: GeneratedArtifact,
  expected: string,
  actual: string | undefined,
): ArtifactCheck {
  return { artifact, status: actual === expected ? 'up-to-date' : 'outdated' };
}

export function resolverTypesCheckOf(codegenExitCode: number): ArtifactCheck {
  return {
    artifact: 'resolver-types',
    status: codegenExitCode === 0 ? 'up-to-date' : 'outdated',
  };
}

function linesOf(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

function problemLinesOf(check: ArtifactCheck): readonly string[] {
  switch (check.status) {
    case 'up-to-date':
      return [];
    case 'outdated':
      return [ARTIFACT_MESSAGES[check.artifact].outdated];
    case 'unbuildable':
      return [UNBUILDABLE_MESSAGE, ...check.errors.map(describeBuildError)];
  }
}

function regenerateLinesOf(
  checks: readonly ArtifactCheck[],
  workDir: string,
): readonly string[] {
  const needed = new Set<string>(
    checks
      .filter(({ status }) => status === 'outdated')
      .map(({ artifact }) => ARTIFACT_MESSAGES[artifact].regenerateCommand),
  );
  if (needed.size === 0) {
    return [];
  }
  return [
    `${workDir}で次の生成コマンドを再実行し、生成物を更新してください。`,
    ...REGENERATE_ORDER.filter((command) => needed.has(command)).map(
      (command) => `  ${command}`,
    ),
  ];
}

export function reportGeneratedChecks(
  checks: readonly ArtifactCheck[],
  workDir: string,
): CheckReport {
  const upToDate = checks
    .filter(({ status }) => status === 'up-to-date')
    .map(({ artifact }) => ARTIFACT_MESSAGES[artifact].upToDate);
  const problems = [
    ...checks.flatMap(problemLinesOf),
    ...regenerateLinesOf(checks, workDir),
  ];
  return {
    exitCode: problems.length === 0 ? 0 : 1,
    stdout: linesOf(upToDate),
    stderr: linesOf(problems),
  };
}
