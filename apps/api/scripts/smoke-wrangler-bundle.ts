import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { unstable_startWorker } from 'wrangler';
import { z } from 'zod';

const SMOKE_DIR = resolve(import.meta.dirname, '..', 'test', 'smoke');

const SMOKE_CONFIG_PATH = join(SMOKE_DIR, 'wrangler.smoke.jsonc');

const WRANGLER_PROJECT_DIR = join(SMOKE_DIR, '.wrangler');

const EXPECTED_GREETING = 'こんにちは、Inversify';

const RELOAD_TIMEOUT_MS = 60_000;

const REQUEST_TIMEOUT_MS = 10_000;

const reloadCompleteSchema = z.object({
  proxyData: z.object({
    userWorkerUrl: z.object({
      protocol: z.string(),
      hostname: z.string(),
      port: z.string(),
    }),
    headers: z.record(z.string(), z.string()),
  }),
});

type UserWorkerEndpoint = z.infer<typeof reloadCompleteSchema>['proxyData'];

const smokeResponseSchema = z.object({ greeting: z.string() });

type SmokeWorker = Awaited<ReturnType<typeof unstable_startWorker>>;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function waitForUserWorker(worker: SmokeWorker): Promise<UserWorkerEndpoint> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${String(RELOAD_TIMEOUT_MS)}ms以内にWorkerの起動が完了しませんでした。`,
        ),
      );
    }, RELOAD_TIMEOUT_MS);
    worker.raw.once('reloadComplete', (event: unknown) => {
      clearTimeout(timer);
      const parsed = reloadCompleteSchema.safeParse(event);
      if (parsed.success) {
        resolvePromise(parsed.data.proxyData);
      } else {
        reject(new Error('起動完了の通知に接続先が含まれていませんでした。'));
      }
    });
  });
}

// 開発用の中継(ProxyWorker)は開発コンテナのサンドボックスで起動したWorkerへの転送が応答しないため、中継と同じ接続先とヘッダーで起動したWorkerへ直接問い合わせる
async function requestGreeting(endpoint: UserWorkerEndpoint): Promise<string> {
  const { protocol, hostname, port } = endpoint.userWorkerUrl;
  const response = await fetch(`${protocol}//${hostname}:${port}/`, {
    headers: endpoint.headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Workerが状態コード${String(response.status)}を返しました。\n${body}`,
    );
  }
  const parsed = smokeResponseSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new Error(`Workerの応答の形式が想定と異なります。\n${body}`);
  }
  return parsed.data.greeting;
}

async function runSmokeTest(): Promise<number> {
  const persistDir = await mkdtemp(join(tmpdir(), 'smoke-wrangler-bundle-'));
  const hadProjectDir = await exists(WRANGLER_PROJECT_DIR);
  let worker: SmokeWorker | undefined;
  try {
    worker = await unstable_startWorker({
      config: SMOKE_CONFIG_PATH,
      dev: {
        persist: persistDir,
        server: { hostname: '127.0.0.1', port: 0 },
        inspector: false,
        watch: false,
        logLevel: 'warn',
      },
    });
    const endpoint = await waitForUserWorker(worker);
    const greeting = await requestGreeting(endpoint);
    if (greeting !== EXPECTED_GREETING) {
      process.stderr.write(
        `Wranglerのバンドルで起動したWorkerの解決結果が想定と異なります。\n  期待: ${EXPECTED_GREETING}\n  実際: ${greeting}\n`,
      );
      return 1;
    }
    process.stdout.write(
      `Wranglerのバンドルで起動したWorkerが@inject付きのクラスを解決しました: ${greeting}\n`,
    );
    return 0;
  } finally {
    // 起動に失敗したWorkerの後始末は例外を投げ得るため、一時ディレクトリの削除はその成否に関わらず行う
    try {
      await worker?.dispose();
    } finally {
      await rm(persistDir, { recursive: true, force: true });
      if (!hadProjectDir) {
        await rm(WRANGLER_PROJECT_DIR, { recursive: true, force: true });
      }
    }
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runSmokeTest();
  } catch (error) {
    process.stderr.write(
      `Wranglerのバンドルでのスモークテストを完了できませんでした: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
