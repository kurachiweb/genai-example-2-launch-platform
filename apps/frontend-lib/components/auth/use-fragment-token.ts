import {
  type AnyRoute,
  type Router,
  type TrailingSlashOption,
  useRouter,
} from '@tanstack/react-router';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { readFragmentToken } from '../../utilities/auth/fragment-token.ts';

export type FragmentTokenState =
  | { readonly status: 'reading' }
  | { readonly status: 'found'; readonly token: string }
  | { readonly status: 'missing' };

const READING: FragmentTokenState = Object.freeze({ status: 'reading' });

const MISSING: FragmentTokenState = Object.freeze({ status: 'missing' });

// 共通部品からはアプリのルーターの型を参照できないため、履歴だけを型付けしたルーターとして読む
type HistoryRouter = Router<AnyRoute, TrailingSlashOption, boolean>;

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
  const { history } = useRouter<HistoryRouter>();
  const hydrated = useHydrated();
  const [token] = useState(() => readFragmentToken(history.location.hash));

  useEffect(() => {
    const { pathname, search, hash, state } = history.location;
    if (readFragmentToken(hash) !== undefined) {
      history.replace(`${pathname}${search}`, state);
    }
  }, [history]);

  if (!hydrated) {
    return READING;
  }
  return token === undefined ? MISSING : { status: 'found', token };
}
