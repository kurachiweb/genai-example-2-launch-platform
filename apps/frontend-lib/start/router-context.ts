import type { QueryClient } from '@tanstack/react-query';
import { createStore } from 'jotai/vanilla';

import type { FrontendRequestContext } from '../server/entry/request-context.ts';
import type { PublicRuntimeConfig } from '../server/env/frontend-env.ts';
import type { DisplayPreferences } from '../utilities/datetime/display-preferences.ts';
import { createAppQueryClient } from './query-client.ts';

export interface AppRuntime {
  readonly publicConfig: PublicRuntimeConfig;
  readonly display: DisplayPreferences;
}

export interface AppRuntimeHolder {
  get(): AppRuntime;
  set(runtime: AppRuntime): void;
}

export interface RouterContext {
  readonly queryClient: QueryClient;
  readonly jotaiStore: ReturnType<typeof createStore>;
  readonly runtime: AppRuntimeHolder;
}

export interface DehydratedAppRuntime {
  readonly runtime: AppRuntime;
}

export function createAppRuntimeHolder(
  initial: AppRuntime | undefined,
): AppRuntimeHolder {
  let current = initial;
  return {
    get: () => {
      if (current === undefined) {
        throw new Error(
          '実行時の値が未設定です。サーバーでは描画の文脈から、ブラウザではhydrateで設定してください。',
        );
      }
      return current;
    },
    set: (runtime) => {
      if (current !== undefined) {
        throw new Error('実行時の値は1回だけ設定できます。');
      }
      current = runtime;
    },
  };
}

export function createRouterContext(
  initialRuntime: AppRuntime | undefined,
): RouterContext {
  return {
    queryClient: createAppQueryClient(),
    jotaiStore: createStore(),
    runtime: createAppRuntimeHolder(initialRuntime),
  };
}

const hasRuntimeHolder = (
  context: unknown,
): context is Pick<RouterContext, 'runtime'> => {
  if (typeof context !== 'object' || context === null) {
    return false;
  }
  const runtime: unknown = Reflect.get(context, 'runtime');
  return (
    typeof runtime === 'object' &&
    runtime !== null &&
    typeof Reflect.get(runtime, 'get') === 'function'
  );
};

// 共通部品はアプリのルーターの型を登録できず、ルーターの文脈が型の無い値になるため、実行時の値の入れ物を持つことを確かめてから読む
export function appRuntimeOf(context: unknown): AppRuntime {
  if (!hasRuntimeHolder(context)) {
    throw new Error(
      'ルーターの文脈に実行時の値がありません。createRouterContextで作った文脈をルーターへ渡してください。',
    );
  }
  return context.runtime.get();
}

// dehydrateした値はHTMLへ書き出されるため、描画の文脈のうちブラウザへ渡してよい公開設定と表示設定だけを取り出す
export function toAppRuntime(
  context: Pick<FrontendRequestContext, 'publicConfig' | 'display'>,
): AppRuntime {
  return { publicConfig: context.publicConfig, display: context.display };
}

export function dehydrateAppRuntime(
  context: RouterContext,
): DehydratedAppRuntime {
  return { runtime: toAppRuntime(context.runtime.get()) };
}

export function hydrateAppRuntime(
  context: RouterContext,
  dehydrated: DehydratedAppRuntime,
): void {
  context.runtime.set(dehydrated.runtime);
}
