import { getGlobalStartContext } from '@tanstack/react-start';

import type { FrontendRequestContext } from '../server/entry/request-context.ts';
import { type AppRuntime, toAppRuntime } from './router-context.ts';

// 共通部品はTanStack StartのRegisterへ要求の文脈の型を登録せず、戻り値の型がundefinedになるため、createFrontendServerEntryがstartHandler.fetchへ渡した文脈を型の無い値として読んでから確かめる
const readStartContext: () => unknown = getGlobalStartContext;

const readFrontendRequestContext = (): FrontendRequestContext => {
  const context = readStartContext();
  if (
    typeof context !== 'object' ||
    context === null ||
    !('nonce' in context) ||
    typeof context.nonce !== 'string'
  ) {
    throw new Error(
      'TanStack Startへ描画の文脈が渡されていません。createFrontendServerEntryを経由してください。',
    );
  }
  return context as FrontendRequestContext;
};

export function readServerRequestNonce(): string {
  return readFrontendRequestContext().nonce;
}

export function readServerInitialRuntime(): AppRuntime {
  return toAppRuntime(readFrontendRequestContext());
}
