import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  ClientUltrasOfferDocument,
  type ClientUltrasOfferQuery,
} from '../../graphql/generated/graphql.ts';
import { ultrasOfferQueryOptions } from '../../graphql/ultras.ts';
import { UltrasPromotionGate } from './ultras-promotion-gate.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CHILD_TEXT = 'Ultrasに加入すると参加費が免除されます。';

const FALLBACK_TEXT = '現在、新規の加入を受け付けていません。';

const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const offerOf = (promotionEnabled: boolean): ClientUltrasOfferQuery => ({
  ultrasOffer: {
    price: { amount: 999, currency: 'usd' },
    priceStale: false,
    promotionEnabled,
  },
});

const renderGate = async (fallback: boolean = true) => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <UltrasPromotionGate
      fallback={fallback ? <p>{FALLBACK_TEXT}</p> : undefined}
    >
      <p>{CHILD_TEXT}</p>
    </UltrasPromotionGate>,
    { context },
  );
  return context;
};

const child = () => page.getByText(CHILD_TEXT);
const fallback = () => page.getByText(FALLBACK_TEXT);
const offerStatus = (context: RouterContext) =>
  context.queryClient.getQueryState(ultrasOfferQueryOptions().queryKey)?.status;

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('UltrasPromotionGate', () => {
  test('機能フラグがオンなら、ultrasOfferを取得して子を描画し、fallbackを描画しない', async () => {
    executeGraphQL.mockResolvedValue({ ok: true, data: offerOf(true) });

    await renderGate();

    await expect.element(child()).toBeVisible();
    expect(fallback().query()).toBeNull();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientUltrasOfferDocument,
      {},
      expect.anything(),
    );
  });

  test('機能フラグがオフなら、子を描画せずfallbackを描画する', async () => {
    executeGraphQL.mockResolvedValue({ ok: true, data: offerOf(false) });

    await renderGate();

    await expect.element(fallback()).toBeVisible();
    expect(child().query()).toBeNull();
  });

  test('機能フラグがオフでfallbackが無ければ、何も描画しない', async () => {
    executeGraphQL.mockResolvedValue({ ok: true, data: offerOf(false) });

    const context = await renderGate(false);

    await expect.poll(() => offerStatus(context)).toBe('success');
    expect(child().query()).toBeNull();
    expect(document.body.textContent.trim()).toBe('');
  });

  test('読み込み中は、子もfallbackも描画しない', async () => {
    executeGraphQL.mockReturnValue(new Promise(() => undefined));

    const context = await renderGate();

    await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
    expect(offerStatus(context)).toBe('pending');
    expect(child().query()).toBeNull();
    expect(fallback().query()).toBeNull();
  });

  test('取得に失敗したら、子もfallbackも描画せず、失敗を境界へ投げない', async () => {
    executeGraphQL.mockResolvedValue({ ok: false, error: LOAD_FAILURE });

    const context = await renderGate();

    await expect.poll(() => offerStatus(context)).toBe('error');
    expect(child().query()).toBeNull();
    expect(fallback().query()).toBeNull();
    expect(document.body.textContent.trim()).toBe('');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('子の表示中に、アクセシビリティの検査の違反が0件', async () => {
      executeGraphQL.mockResolvedValue({ ok: true, data: offerOf(true) });
      await renderGate();
      await expect.element(child()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
