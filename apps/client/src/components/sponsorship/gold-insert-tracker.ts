export interface GoldInsertTracker {
  // 解除の関数を返す。同じ解除の関数を何度呼んでも1回だけ解除する
  readonly register: (position: number) => () => void;
  readonly subscribe: (listener: () => void) => () => void;
  // 描画済みの差し込みの数
  readonly getSnapshot: () => number;
  // サーバーの描画では差し込みがまだ描かれていないため未確定
  readonly getServerSnapshot: () => null;
}

// 一覧の差し込みの描画の後に決まる数を、一覧の下の余りへ伝える。useSyncExternalStoreへメソッドを個別に渡せるよう、thisに依存しないクロージャで持つ
export function createGoldInsertTracker(): GoldInsertTracker {
  // 同じ位置の差し込みを二重に描いても1つと数えるため、位置ごとの登録の数を持つ
  const registrations = new Map<number, number>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const register = (position: number): (() => void) => {
    const current = registrations.get(position) ?? 0;
    registrations.set(position, current + 1);
    if (current === 0) {
      notify();
    }
    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      const remaining = (registrations.get(position) ?? 1) - 1;
      if (remaining > 0) {
        registrations.set(position, remaining);
        return;
      }
      registrations.delete(position);
      notify();
    };
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    register,
    subscribe,
    getSnapshot: () => registrations.size,
    getServerSnapshot: () => null,
  };
}

export const goldInsertTracker: GoldInsertTracker = createGoldInsertTracker();
