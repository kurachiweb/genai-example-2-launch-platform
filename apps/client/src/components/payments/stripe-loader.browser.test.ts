import type { Stripe } from '@stripe/stripe-js';
import { describe, expect, test, vi } from 'vitest';

import {
  createStripeLoader,
  loadStripeOnce,
  type StripeLoad,
} from './stripe-loader.ts';

const PUBLISHABLE_KEY = ['pk', 'test', 'first'].join('_');

const OTHER_PUBLISHABLE_KEY = ['pk', 'test', 'second'].join('_');

const STRIPE_SCRIPT_SELECTOR = 'script[src^="https://js.stripe.com"]';

const fakeStripe = (label: string): Stripe => ({ label }) as unknown as Stripe;

describe('createStripeLoader', () => {
  test('同じ公開キーで何度呼んでも読み込みは1回だけで、同じStripeを返す', async () => {
    const stripe = fakeStripe('first');
    const load = vi.fn<StripeLoad>(() => Promise.resolve(stripe));
    const loadOnce = createStripeLoader(load);

    const results = await Promise.all([
      loadOnce(PUBLISHABLE_KEY),
      loadOnce(PUBLISHABLE_KEY),
    ]);
    const later = await loadOnce(PUBLISHABLE_KEY);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(PUBLISHABLE_KEY);
    expect(results).toEqual([stripe, stripe]);
    expect(later).toBe(stripe);
  });

  test('公開キーが異なれば、公開キーごとに1回ずつ読み込む', async () => {
    const load = vi.fn<StripeLoad>((key) => Promise.resolve(fakeStripe(key)));
    const loadOnce = createStripeLoader(load);

    await loadOnce(PUBLISHABLE_KEY);
    await loadOnce(OTHER_PUBLISHABLE_KEY);
    await loadOnce(PUBLISHABLE_KEY);
    await loadOnce(OTHER_PUBLISHABLE_KEY);

    expect(load.mock.calls).toEqual([
      [PUBLISHABLE_KEY],
      [OTHER_PUBLISHABLE_KEY],
    ]);
  });

  test('公開キーが無いときは読み込まずnullを返す', async () => {
    const load = vi.fn<StripeLoad>(() => Promise.resolve(fakeStripe('unused')));
    const loadOnce = createStripeLoader(load);

    const result = await loadOnce(undefined);

    expect(result).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  test('読み込みが失敗したときは失敗を返し、次の呼び出しで読み込み直す', async () => {
    const failure = new Error('Stripe.jsを読み込めませんでした');
    const stripe = fakeStripe('retried');
    const load = vi
      .fn<StripeLoad>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(stripe);
    const loadOnce = createStripeLoader(load);

    await expect(loadOnce(PUBLISHABLE_KEY)).rejects.toBe(failure);
    expect(await loadOnce(PUBLISHABLE_KEY)).toBe(stripe);
    expect(await loadOnce(PUBLISHABLE_KEY)).toBe(stripe);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('loadStripeOnce', () => {
  test('公開キーが無いときはStripe.jsのスクリプトを挿入せずnullを返す', async () => {
    expect(await loadStripeOnce(undefined)).toBeNull();
    expect(document.querySelector(STRIPE_SCRIPT_SELECTOR)).toBeNull();
  });
});
