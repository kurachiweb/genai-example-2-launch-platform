import { access, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface RepoFiles {
  readonly root: string;
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  list(pattern: string): Promise<readonly string[]>;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isOutside = (root: string, path: string): boolean => {
  if (isAbsolute(path)) return true;
  const fromRoot = relative(root, resolve(root, path));
  return fromRoot === '..' || fromRoot.startsWith(`..${sep}`);
};

const outsideError = (path: string): Error =>
  new Error(`リポジトリの外を指すパスは扱えません: ${path}`);

export function createRepoFiles(root: string): RepoFiles {
  const insideOrThrow = (path: string): string => {
    if (isOutside(root, path) || path.split('/').includes('..')) {
      throw outsideError(path);
    }
    return resolve(root, path);
  };

  return {
    root,
    readText: async (path) => {
      const absolutePath = insideOrThrow(path);
      try {
        return await readFile(absolutePath, 'utf8');
      } catch (error) {
        throw new Error(`${path}を読み込めませんでした: ${messageOf(error)}`, {
          cause: error,
        });
      }
    },
    exists: async (path) => {
      const absolutePath = insideOrThrow(path);
      try {
        await access(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
    list: async (pattern) => {
      insideOrThrow(pattern);
      const paths = await Array.fromAsync(
        new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true, dot: true }),
      );
      return paths.toSorted();
    },
  };
}
