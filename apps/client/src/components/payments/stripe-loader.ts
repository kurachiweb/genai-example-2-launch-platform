import type { Stripe } from '@stripe/stripe-js';
// 既定の入口は読み込まれた時点でStripe.jsのスクリプトを挿入するため、loadStripeを呼ぶまで挿入しないpureの入口を使う
import { loadStripe } from '@stripe/stripe-js/pure';

export type StripeLoad = (publishableKey: string) => Promise<Stripe | null>;

export type StripeLoadOnce = (
  publishableKey: string | undefined,
) => Promise<Stripe | null>;

// loadStripeは呼ぶたびにStripeのインスタンスを作るため、公開キーごとに最初の読み込みの結果を使い回す。失敗した読み込みは次の呼び出しでやり直せるよう残さない
export function createStripeLoader(load: StripeLoad): StripeLoadOnce {
  const loads = new Map<string, Promise<Stripe | null>>();
  return (publishableKey) => {
    if (publishableKey === undefined) {
      return Promise.resolve(null);
    }
    const loaded = loads.get(publishableKey);
    if (loaded !== undefined) {
      return loaded;
    }
    const loading = load(publishableKey).catch((error: unknown) => {
      loads.delete(publishableKey);
      throw error;
    });
    loads.set(publishableKey, loading);
    return loading;
  };
}

export const loadStripeOnce: StripeLoadOnce = createStripeLoader(loadStripe);
