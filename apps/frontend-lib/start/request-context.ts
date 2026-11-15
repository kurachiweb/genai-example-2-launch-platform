import { createIsomorphicFn } from '@tanstack/react-start';

import {
  readServerInitialRuntime,
  readServerRequestNonce,
} from './request-context.server.ts';
import type { AppRuntime } from './router-context.ts';

// ブラウザではルーターがmeta要素のcsp-nonceからnonceを読むため、値を返さない
export const readRequestNonce = createIsomorphicFn()
  .server((): string | undefined => readServerRequestNonce())
  .client((): string | undefined => undefined);

// ブラウザではルーターのhydrateで実行時の値を設定するため、初期値を返さない
export const readInitialRuntime = createIsomorphicFn()
  .server((): AppRuntime | undefined => readServerInitialRuntime())
  .client((): AppRuntime | undefined => undefined);
