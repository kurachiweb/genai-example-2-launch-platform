export type LocalWorker = 'api' | 'event';

interface WorkerOriginDefinition {
  readonly defaultOrigin: string;
  readonly originEnvKey: string;
}

const WORKER_ORIGINS: Readonly<Record<LocalWorker, WorkerOriginDefinition>> = {
  api: {
    defaultOrigin: 'http://localhost:48042',
    originEnvKey: 'E2E_API_URL',
  },
  event: {
    defaultOrigin: 'http://localhost:48043',
    originEnvKey: 'E2E_EVENT_URL',
  },
};

// 空文字を設定しても空のURLで要求しないよう、未設定と同じく既定のオリジンを使う
export function resolveLocalWorkerOrigin(
  worker: LocalWorker,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const { defaultOrigin, originEnvKey } = WORKER_ORIGINS[worker];
  return env[originEnvKey] || defaultOrigin;
}
