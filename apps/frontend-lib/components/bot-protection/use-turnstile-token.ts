import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { type RefObject, useCallback, useMemo, useRef, useState } from 'react';

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
}

export interface TurnstileTokenController extends TurnstileTokenState {
  readonly widgetProps: TurnstileWidgetProps;
}

interface TokenSnapshot {
  readonly token: string | undefined;
  readonly status: TurnstileStatus;
}

const INITIAL_SNAPSHOT: TokenSnapshot = { token: undefined, status: 'idle' };

export function useTurnstileToken(): TurnstileTokenController {
  const widgetRef = useRef<TurnstileInstance | undefined>(undefined);
  // 同じイベントの中で2回取り出しても同じトークンを2回返さないため、描画を待たずに読み書きできる値でも持つ
  const tokenRef = useRef<string | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<TokenSnapshot>(INITIAL_SNAPSHOT);

  const update = useCallback((next: TokenSnapshot) => {
    tokenRef.current = next.token;
    setSnapshot(next);
  }, []);

  const onSuccess = useCallback(
    (token: string) => {
      update({ token, status: 'ready' });
    },
    [update],
  );

  const onExpire = useCallback(() => {
    update({ token: undefined, status: 'expired' });
    widgetRef.current?.reset();
  }, [update]);

  const onError = useCallback(() => {
    update({ token: undefined, status: 'error' });
  }, [update]);

  const consume = useCallback((): string | undefined => {
    const token = tokenRef.current;
    if (token === undefined) {
      return undefined;
    }
    update(INITIAL_SNAPSHOT);
    widgetRef.current?.reset();
    return token;
  }, [update]);

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
    widgetProps,
  };
}
