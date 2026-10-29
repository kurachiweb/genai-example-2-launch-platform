import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface RepoFiles {
  readonly root: string;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
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
    writeText: async (path, text) => {
      const absolutePath = insideOrThrow(path);
      try {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, text);
      } catch (error) {
        throw new Error(`${path}へ書き出せませんでした: ${messageOf(error)}`, {
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
