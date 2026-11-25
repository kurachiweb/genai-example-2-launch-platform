import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CACHE_DIR = join(import.meta.dirname, '..', '..', 'test-results');

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/u;

// 開発サーバーが重い時の一時的な待ちの不足で用意が失敗し得るため、新しい利用者などを作り直して数回までやり直す
const BUILD_ATTEMPTS = 3;

type CacheRecord = { readonly ok: unknown } | { readonly failed: string };

type CacheEntries = Readonly<Record<string, CacheRecord>>;

export interface WorldCache {
  readonly worldCachePath: () => string;
  readonly cachedWorld: <T>(key: string, build: () => Promise<T>) => Promise<T>;
  readonly peekWorld: <T>(key: string) => Promise<T | undefined>;
  readonly forgetWorld: (key: string) => Promise<void>;
}

const environmentKeyOf = (namespace: string, suffix: string): string =>
  `${namespace.toUpperCase().replaceAll('-', '_')}_ROUTES_${suffix}`;

// 失敗したテストの後にPlaywrightがワーカーを作り直しても用意した状態を使い回せるよう、実行を起こしたプロセス(ワーカーの親)ごとのファイルに残す。繰り返しの実行で使い回したい時は環境変数(例: `CLIENT_ROUTES_WORLD_FILE`)でファイルを指定する
export const worldCachePath = (namespace: string): string =>
  process.env[environmentKeyOf(namespace, 'WORLD_FILE')] ||
  join(CACHE_DIR, `${namespace}-route-world-${String(process.ppid)}.json`);

// 7.1へ渡す違反とヘッダーの不足の一覧のファイル。実行ごとに追記し、ワーカーが作り直されても途切れない
export const findingsFilePath = (namespace: string): string =>
  process.env[environmentKeyOf(namespace, 'FINDINGS_FILE')] ||
  join(CACHE_DIR, `${namespace}-route-findings-${String(process.ppid)}.jsonl`);

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

async function writeEntries(
  path: string,
  entries: CacheEntries,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(entries), 'utf8');
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// 名前空間ごとに別のファイルと進行中の用意を持つため、利用者側・管理者側・画面の幅の検査などが鍵の名前を気にせず同じ実行に同居できる。値はJSONで表せるものに限る
export function worldCache(namespace: string): WorldCache {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(`用意の名前空間として使えない名前です: ${namespace}`);
  }
  const path = (): string => worldCachePath(namespace);
  const inFlight = new Map<string, Promise<unknown>>();

  async function store(key: string, record: CacheRecord): Promise<void> {
    const latest = await readEntries(path());
    await writeEntries(path(), { ...latest, [key]: record });
  }

  // 用意に失敗した記録も残し、その状態を使う全てのテストが長い用意をやり直さず同じ理由で失敗するようにする
  async function loadOrBuild<T>(
    key: string,
    build: () => Promise<T>,
  ): Promise<T> {
    const cached = (await readEntries(path()))[key];
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

  // 同じ鍵の用意が重ならないよう、進行中の用意は共有する
  function cachedWorld<T>(key: string, build: () => Promise<T>): Promise<T> {
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
  async function peekWorld<T>(key: string): Promise<T | undefined> {
    const cached = (await readEntries(path()))[key];
    return cached !== undefined && 'ok' in cached
      ? (cached.ok as T)
      : undefined;
  }

  // 後始末で消した対象が、作り直されたワーカーや繰り返しの実行で用意済みの状態として使い回されないよう、記録を消す
  async function forgetWorld(key: string): Promise<void> {
    const remaining = Object.entries(await readEntries(path())).filter(
      ([entryKey]) => entryKey !== key,
    );
    await writeEntries(path(), Object.fromEntries(remaining));
  }

  return { worldCachePath: path, cachedWorld, peekWorld, forgetWorld };
}
