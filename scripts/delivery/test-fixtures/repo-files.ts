import type { GithubActionsIo } from '../adapters/github-actions.ts';
import type { RepoFiles } from '../adapters/repo-files.ts';
import type { DeliveryDeps } from '../commands/shared/delivery-command.ts';
import { type RecordingOutput, createRecordingOutput } from './text-output.ts';

export const FAKE_REPO_ROOT = '/repo';

export interface FakeRepoFiles extends RepoFiles {
  readonly readPaths: () => readonly string[];
}

export const createFakeRepoFiles = (
  texts: Readonly<Record<string, string>>,
): FakeRepoFiles => {
  const readPaths: string[] = [];
  const paths = Object.keys(texts);
  return {
    root: FAKE_REPO_ROOT,
    readText: (path) => {
      readPaths.push(path);
      const text = texts[path];
      return text === undefined
        ? Promise.reject(
            new Error(`${path}を読み込めませんでした: ENOENT: no such file`),
          )
        : Promise.resolve(text);
    },
    exists: (path) => Promise.resolve(paths.includes(path)),
    list: (pattern) => {
      const glob = new Bun.Glob(pattern);
      return Promise.resolve(
        paths.filter((path) => glob.match(path)).toSorted(),
      );
    },
    readPaths: () => [...new Set(readPaths)].toSorted(),
  };
};

export interface FakeDeps {
  readonly deps: DeliveryDeps;
  readonly stdout: RecordingOutput;
  readonly stderr: RecordingOutput;
  readonly summaries: () => readonly string[];
}

const unused = (what: string) => (): never => {
  throw new Error(`${what}は使わない`);
};

export const createFakeDeps = (files: RepoFiles): FakeDeps => {
  const summaries: string[] = [];
  const github: GithubActionsIo = {
    mask: unused('マスク'),
    exportEnv: unused('環境変数の書き出し'),
    summary: (markdown) => {
      summaries.push(markdown);
    },
    oidcToken: unused('OIDC'),
  };
  const stdout = createRecordingOutput();
  const stderr = createRecordingOutput();
  return {
    deps: {
      repoRoot: files.root,
      env: {},
      runner: { run: unused('子プロセス'), start: unused('常駐の起動') },
      files,
      github,
      stdout,
      stderr,
    },
    stdout,
    stderr,
    summaries: () => [...summaries],
  };
};

export const withoutPath = (
  texts: Readonly<Record<string, string>>,
  path: string,
): Record<string, string> =>
  Object.fromEntries(Object.entries(texts).filter(([key]) => key !== path));
