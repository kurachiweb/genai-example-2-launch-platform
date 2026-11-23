import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CACHE_FILE_ENV_KEY = 'CLIENT_ROUTES_WORLD_FILE';

const CACHE_DIR = join(import.meta.dirname, '..', '..', '..', 'test-results');

// 開発サーバーが重い時の一時的な待ちの不足で用意が失敗し得るため、新しい利用者などを作り直して数回までやり直す
const BUILD_ATTEMPTS = 3;

type CacheRecord = { readonly ok: unknown } | { readonly failed: string };

type CacheEntries = Readonly<Record<string, CacheRecord>>;

// 失敗したテストの後にPlaywrightがワーカーを作り直しても用意した状態を使い回せるよう、実行を起こしたプロセス(ワーカーの親)ごとのファイルに残す。繰り返しの実行で使い回したい時は環境変数でファイルを指定する
export const worldCachePath = (): string =>
  process.env[CACHE_FILE_ENV_KEY] ||
  join(CACHE_DIR, `client-route-world-${String(process.ppid)}.json`);

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error as { readonly code: unknown }).code === 'ENOENT';

async function readEntries(path: string): Promise<CacheEntries> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CacheEntries;
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return {};
    }
    throw error;
  }
}

async function store(key: string, record: CacheRecord): Promise<void> {
  const path = worldCachePath();
  const latest = await readEntries(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...latest, [key]: record }), 'utf8');
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// 用意に失敗した記録も残し、その状態を使う全てのテストが長い用意をやり直さず同じ理由で失敗するようにする
async function loadOrBuild<T>(
  key: string,
  build: () => Promise<T>,
): Promise<T> {
  const cached = (await readEntries(worldCachePath()))[key];
  if (cached !== undefined) {
    if ('failed' in cached) {
      throw new Error(`状態「${key}」の用意に失敗済みです: ${cached.failed}`);
    }
    return cached.ok as T;
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= BUILD_ATTEMPTS; attempt += 1) {
    try {
      const value = await build();
      await store(key, { ok: value });
      return value;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  await store(key, { failed: messageOf(lastError) });
  throw lastError;
}

const inFlight = new Map<string, Promise<unknown>>();

// 値はJSONで表せるものに限る。同じ鍵の用意が重ならないよう、進行中の用意は共有する
export function cachedWorld<T>(
  key: string,
  build: () => Promise<T>,
): Promise<T> {
  const running = inFlight.get(key);
  if (running !== undefined) {
    return running as Promise<T>;
  }
  const started = loadOrBuild(key, build).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}

// 用意を始めずに、既に用意した状態があれば読む。後始末が、用意していない状態を作ってしまわないために使う
export async function peekWorld<T>(key: string): Promise<T | undefined> {
  const cached = (await readEntries(worldCachePath()))[key];
  return cached !== undefined && 'ok' in cached ? (cached.ok as T) : undefined;
}

const FINDINGS_FILE_ENV_KEY = 'CLIENT_ROUTES_FINDINGS_FILE';

export const findingsFilePath = (): string =>
  process.env[FINDINGS_FILE_ENV_KEY] ||
  join(CACHE_DIR, `client-route-findings-${String(process.ppid)}.jsonl`);
