import { messageOf } from '../../catalog/error-message.ts';
import type { RepoFiles } from '../../adapters/repo-files.ts';

export type Loaded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

export const loaded = <T>(value: T): Loaded<T> => ({ ok: true, value });

export const failed = <T>(errors: readonly string[]): Loaded<T> => ({
  ok: false,
  errors,
});

export const errorsOf = (
  results: readonly Loaded<unknown>[],
): readonly string[] => [
  ...new Set(results.flatMap((result) => (result.ok ? [] : result.errors))),
];

export function allLoaded<T>(
  results: readonly Loaded<T>[],
): Loaded<readonly T[]> {
  const errors = errorsOf(results);
  return errors.length > 0
    ? failed(errors)
    : loaded(results.flatMap((result) => (result.ok ? [result.value] : [])));
}

export async function readInput(
  files: RepoFiles,
  path: string,
): Promise<Loaded<string>> {
  try {
    return loaded(await files.readText(path));
  } catch (error) {
    return failed([messageOf(error)]);
  }
}

export function parseInput(
  path: string,
  text: string,
  format: string,
  parse: (text: string) => unknown,
): Loaded<unknown> {
  try {
    return loaded(parse(text));
  } catch (error) {
    return failed([
      `${path}: ${format}として解析できません(${messageOf(error)})`,
    ]);
  }
}
