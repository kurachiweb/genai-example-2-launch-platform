import { readFile } from 'node:fs/promises';

export class JsonSourceError extends Error {
  override readonly name = 'JsonSourceError';
}

export type ReadText = (path: string) => Promise<string>;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const readTextFile: ReadText = async (path) => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new JsonSourceError(
      `${path}を読み込めませんでした: ${messageOf(error)}`,
      { cause: error },
    );
  }
};

const parseArray = (text: string, source: string): readonly unknown[] => {
  try {
    return JSON.parse(text) as readonly unknown[];
  } catch (error) {
    throw new JsonSourceError(
      `${source}をJSON配列として読めませんでした: ${messageOf(error)}`,
      { cause: error },
    );
  }
};

const parseLine = (
  line: string,
  source: string,
  lineNumber: number,
): unknown => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new JsonSourceError(
      `${source}の${String(lineNumber)}行目をJSONとして読めませんでした: ${messageOf(error)}`,
      { cause: error },
    );
  }
};

export function parseJsonRecords(
  text: string,
  source: string,
): readonly unknown[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return parseArray(trimmed, source);
  return text
    .split('\n')
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line !== '')
    .map(({ line, lineNumber }) => parseLine(line, source, lineNumber));
}

export async function readJsonRecords(
  path: string,
  readText: ReadText = readTextFile,
): Promise<readonly unknown[]> {
  return parseJsonRecords(await readText(path), path);
}
