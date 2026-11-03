import type { TurnstileInstance } from '@marsidev/react-turnstile';
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { createTokenWaiters } from '../../utilities/bot-protection/token-waiters.ts';

export type TurnstileStatus = 'idle' | 'ready' | 'expired' | 'error';

export interface TurnstileWidgetProps {
  readonly action?: string | undefined;
  readonly status: TurnstileStatus;
  readonly widgetRef: RefObject<TurnstileInstance | undefined>;
  readonly onSuccess: (token: string) => void;
  readonly onExpire: () => void;
  readonly onError: () => void;
}

export interface TurnstileTokenState {
  readonly token: string | undefined;
  readonly status: TurnstileStatus;
  consume(): string | undefined;
  waitForToken(): Promise<string | undefined>;
}

export interface TurnstileTokenController extends TurnstileTokenState {
  readonly widgetProps: TurnstileWidgetProps;
}

interface TokenSnapshot {
  readonly token: string | undefined;
  readonly status: TurnstileStatus;
}

const INITIAL_SNAPSHOT: TokenSnapshot = { token: undefined, status: 'idle' };

// 非表示のウィジェットの判定は通常数秒で終わる。届かない時に送信中のまま待たせ続けないための上限
export const TOKEN_WAIT_TIMEOUT_MS = 10_000;

export function useTurnstileToken(): TurnstileTokenController {
  const widgetRef = useRef<TurnstileInstance | undefined>(undefined);
  // 同じイベントの中で2回取り出しても同じトークンを2回返さないため、描画を待たずに読み書きできる値でも持つ
  const snapshotRef = useRef<TokenSnapshot>(INITIAL_SNAPSHOT);
  const [snapshot, setSnapshot] = useState<TokenSnapshot>(INITIAL_SNAPSHOT);
  const [waiters] = useState(createTokenWaiters);

  const update = useCallback((next: TokenSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const startOver = useCallback(() => {
    update(INITIAL_SNAPSHOT);
    widgetRef.current?.reset();
  }, [update]);

  const onSuccess = useCallback(
    (token: string) => {
      if (waiters.deliver(token)) {
        startOver();
        return;
      }
      update({ token, status: 'ready' });
    },
    [waiters, startOver, update],
  );

  const onExpire = useCallback(() => {
    waiters.cancelAll();
    update({ token: undefined, status: 'expired' });
    widgetRef.current?.reset();
  }, [waiters, update]);

  const onError = useCallback(() => {
    waiters.cancelAll();
    update({ token: undefined, status: 'error' });
  }, [waiters, update]);

  const consume = useCallback((): string | undefined => {
    const { token } = snapshotRef.current;
    if (token === undefined) {
      return undefined;
    }
    startOver();
    return token;
  }, [startOver]);

  const waitForToken = useCallback((): Promise<string | undefined> => {
    const token = consume();
    if (token !== undefined || snapshotRef.current.status === 'error') {
      return Promise.resolve(token);
    }
    return waiters.wait(TOKEN_WAIT_TIMEOUT_MS);
  }, [consume, waiters]);

  useEffect(
    () => () => {
      waiters.cancelAll();
    },
    [waiters],
  );

  const widgetProps = useMemo<TurnstileWidgetProps>(
    () => ({
      status: snapshot.status,
      widgetRef,
      onSuccess,
      onExpire,
      onError,
    }),
    [snapshot.status, onSuccess, onExpire, onError],
  );

  return {
    token: snapshot.token,
    status: snapshot.status,
    consume,
    waitForToken,
    widgetProps,
  };
}
