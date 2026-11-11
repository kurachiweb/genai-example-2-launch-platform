import { useEffect, useEffectEvent, useRef } from 'react';

// Tailwind CSSの`md:`の出し分けと同じ境界にする
export const MEDIUM_SCREEN_QUERY = '(min-width: 48rem)';

export interface CloseOnWideScreenOptions {
  readonly open: boolean;
  // 起動のボタンを隠すCSSのブレークポイントと同じ条件
  readonly query: string;
  readonly onClose: () => void;
  // 閉じた後に、同じ操作のできる広い画面で見えている要素へフォーカスを移す
  readonly onWideScreenFocus: () => void;
}

// 狭い画面でだけ起動のボタンを見せるシートは、開いたまま境界を越えて広がるとボタンがCSSで隠れ、閉じた後のフォーカスの戻り先を失うため、閉じて見えている要素へ移す。戻り値はSheetContentのonCloseAutoFocusに渡す
export function useCloseOnWideScreen({
  open,
  query,
  onClose,
  onWideScreenFocus,
}: CloseOnWideScreenOptions): (event: Event) => void {
  const closedByWideningRef = useRef(false);
  const close = useEffectEvent(onClose);

  // サーバーの描画に画面幅を持ち込まないよう、開いている間だけブラウザで購読する
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const wideScreen = window.matchMedia(query);
    const closeOnWidening = (event: MediaQueryListEvent) => {
      if (event.matches) {
        closedByWideningRef.current = true;
        close();
      }
    };
    wideScreen.addEventListener('change', closeOnWidening);
    return () => {
      wideScreen.removeEventListener('change', closeOnWidening);
    };
  }, [open, query]);

  return (event: Event) => {
    if (closedByWideningRef.current) {
      closedByWideningRef.current = false;
      event.preventDefault();
      onWideScreenFocus();
    }
  };
}
