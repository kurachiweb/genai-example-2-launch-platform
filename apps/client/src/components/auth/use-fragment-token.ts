import { useRouter } from '@tanstack/react-router';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { readFragmentToken } from './fragment-token.ts';

export type FragmentTokenState =
  | { readonly status: 'reading' }
  | { readonly status: 'found'; readonly token: string }
  | { readonly status: 'missing' };

const READING: FragmentTokenState = Object.freeze({ status: 'reading' });

const MISSING: FragmentTokenState = Object.freeze({ status: 'missing' });

const subscribeNothing = () => () => undefined;

// フラグメントはサーバーの描画に届かないため、サーバーの描画とハイドレーションの間は読み取り中として描き、描画の結果を食い違わせない
const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

// 最初の描画で読んだトークンを保ち、トークンを履歴・画面のURL・共有されるURLに残さないよう、描いた後に同じ履歴の項目を置き換えてフラグメントを消す
export function useFragmentToken(): FragmentTokenState {
  const router = useRouter();
  const hydrated = useHydrated();
  const [token] = useState(() =>
    readFragmentToken(router.history.location.hash),
  );

  useEffect(() => {
    const { pathname, search, hash, state } = router.history.location;
    if (readFragmentToken(hash) !== undefined) {
      router.history.replace(`${pathname}${search}`, state);
    }
  }, [router]);

  if (!hydrated) {
    return READING;
  }
  return token === undefined ? MISSING : { status: 'found', token };
}
