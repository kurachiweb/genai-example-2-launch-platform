import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import type { ClientViewerQuery } from '../../graphql/generated/graphql.ts';
import { productPageViewOf } from '../product-page/product-page-fixtures.ts';
import type { ProductPageContext } from '../product-page/product-page-section-types.ts';
import { ProductReportLink } from './product-report-link.tsx';
import {
  acceptedResult,
  cancelButton,
  dialog,
  fillValidReport,
  passBotCheck,
  radio,
  respondWith,
  submitButton,
  submitCalls,
} from './report-dialog-testing.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const PRODUCT_ID = '01JD0PRODUCT00000000000001';

const LABEL = 'このプロダクトを通報';

const GUEST: ClientViewerQuery = { viewer: null };

const contextOf = ({
  signedIn,
  isOwner,
}: {
  readonly signedIn: boolean;
  readonly isOwner: boolean;
}): ProductPageContext => ({
  product: {
    id: PRODUCT_ID,
    handle: 'Pitch-Notes',
    name: 'Pitch Notes',
    listed: true,
    ownerHandle: 'scout_ken',
  },
  viewer: { signedIn, isOwner },
  page: productPageViewOf({ viewerIsOwner: isOwner }),
  autoRefresh: true,
  reportAutoUpdating: () => undefined,
});

const renderLink = async ({
  signedIn = false,
  isOwner = false,
}: { readonly signedIn?: boolean; readonly isOwner?: boolean } = {}) => {
  await renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <p>本文の末尾</p>
      <ProductReportLink {...contextOf({ signedIn, isOwner })} />
    </main>,
    { cachedViewer: signedIn ? signedInViewerQuery() : GUEST },
  );
};

const reportButton = () => page.getByRole('button', { name: LABEL });

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('ProductReportLink', () => {
  test.each([
    ['未ログイン', false],
    ['ログイン中の本人以外', true],
  ])(
    '%sの閲覧者には、ページを移動しない操作として`button`要素の「このプロダクトを通報」を示す',
    async (_name, signedIn) => {
      respondWith();
      await renderLink({ signedIn });

      await expect.element(reportButton()).toBeVisible();
      expect(reportButton().element().tagName).toBe('BUTTON');
      expect(page.getByRole('link').query()).toBeNull();
    },
  );

  test('投稿者本人には何も描かない', async () => {
    respondWith();
    await renderLink({ signedIn: true, isOwner: true });

    await expect.element(page.getByText('本文の末尾')).toBeVisible();
    expect(reportButton().query()).toBeNull();
    expect(page.getByRole('main').element().children).toHaveLength(1);
  });

  test('押すと題「このプロダクトを通報」のダイアログを開き、プロダクトのIDを対象として送る', async () => {
    respondWith(acceptedResult);
    await renderLink();

    await userEvent.click(reportButton());

    await expect
      .element(page.getByRole('dialog', { name: LABEL }))
      .toBeVisible();
    passBotCheck();
    await fillValidReport();
    await userEvent.click(submitButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(submitCalls()).toHaveLength(1);
    expect(submitCalls()[0]?.[1]).toMatchObject({
      input: { targetKind: 'PRODUCT', targetRef: PRODUCT_ID },
    });
    await expect.element(reportButton()).toHaveFocus();
  });

  test('ダイアログを閉じると「このプロダクトを通報」へフォーカスを戻す', async () => {
    respondWith();
    await renderLink();
    await userEvent.click(reportButton());
    await expect.element(radio('スパム')).toBeVisible();

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(reportButton()).toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('操作とダイアログで、アクセシビリティの検査の違反が0件', async () => {
      respondWith();
      await renderLink();
      await expect.element(reportButton()).toBeVisible();
      const closed = await runAxe(document.body);

      await userEvent.click(reportButton());
      await expect.element(radio('スパム')).toBeVisible();

      expect(closed).toStrictEqual([]);
      expect(await runAxe(dialog().element())).toStrictEqual([]);
    });
  });
});
