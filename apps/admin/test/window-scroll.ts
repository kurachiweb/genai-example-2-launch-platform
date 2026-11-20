import type { AnyRouter } from '@tanstack/react-router';
import { onTestFinished } from 'vitest';

// 一覧の件数や画面の大きさに関わらずページを縦にスクロールでき、取り直した一覧が短くなっても位置が端で詰められないよう、本文の後ろに画面の高さの2倍の要素を足して画面の半分だけスクロールする
export function scrollPageDown(): number {
  const spacer = document.createElement('div');
  spacer.style.height = '200vh';
  document.body.append(spacer);
  window.scrollTo({ top: Math.floor(window.innerHeight / 2) });
  onTestFinished(() => {
    spacer.remove();
    window.scrollTo({ top: 0 });
  });
  return window.scrollY;
}

// ルーターは描画の後の購読でスクロールを先頭へ戻すため、その後に呼ばれる次の描画の通知を待つ
export const nextRendered = (router: AnyRouter): Promise<void> =>
  new Promise((resolve) => {
    const unsubscribe = router.subscribe('onRendered', () => {
      unsubscribe();
      resolve();
    });
  });
