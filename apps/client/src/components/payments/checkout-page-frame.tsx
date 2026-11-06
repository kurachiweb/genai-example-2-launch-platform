import type { ReactNode } from 'react';

import { CHECKOUT_PAGE_TITLE } from './checkout-messages.ts';
import { CHECKOUT_HEADING_ID } from './use-checkout-retry.ts';

export interface CheckoutPageFrameProps {
  // 既定は決済画面の題名
  readonly title?: string;
  readonly children: ReactNode;
}

// 決済画面と決済後のランディングの題名と本文の枠。読み込み中・失敗・見つからない表示は決済の部品(Stripe.js)を読み込まずにこの枠だけを使う
export function CheckoutPageFrame({
  title = CHECKOUT_PAGE_TITLE,
  children,
}: CheckoutPageFrameProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        id={CHECKOUT_HEADING_ID}
        tabIndex={-1}
        className="rounded-sm text-3xl font-extrabold tracking-tight sm:text-4xl"
      >
        {title}
      </h1>
      {children}
    </div>
  );
}
