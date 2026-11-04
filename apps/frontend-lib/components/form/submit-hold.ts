import { createContext, use, useEffect, useRef } from 'react';

// 値がまだ決まっていない欄(アップロード中の欄など)。フォームが送信を止めた時に、欄が待つ理由を示してフォーカスを受ける
export interface SubmitHold {
  readonly onSubmitHeld: () => void;
}

export interface SubmitHolds {
  // 登録を外す関数を返す
  readonly hold: (entry: SubmitHold) => () => void;
  // 最も早く登録した欄。無ければundefined
  readonly first: () => SubmitHold | undefined;
}

export function createSubmitHolds(): SubmitHolds {
  const entries = new Set<SubmitHold>();
  return {
    hold: (entry) => {
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
    first: () => entries.values().next().value,
  };
}

export const SubmitHoldsContext = createContext<SubmitHolds | null>(null);

// activeの間、囲むAppFormの送信を止める。AppFormの外では何もしない
export function useSubmitHold(active: boolean, onSubmitHeld: () => void): void {
  const holds = use(SubmitHoldsContext);
  const onSubmitHeldRef = useRef(onSubmitHeld);

  useEffect(() => {
    onSubmitHeldRef.current = onSubmitHeld;
  }, [onSubmitHeld]);

  useEffect(() => {
    if (!active || holds === null) {
      return undefined;
    }
    return holds.hold({
      onSubmitHeld: () => {
        onSubmitHeldRef.current();
      },
    });
  }, [active, holds]);
}
