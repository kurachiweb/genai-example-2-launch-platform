import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../lib/test/fake-turnstile.tsx';
import type { ProductDeleteNotice } from '../src/components/product/product-section-types.ts';
import {
  ClientDeleteProductDocument,
  ClientMyProductDocument,
} from '../src/graphql/generated/graphql.ts';
import {
  callsOf,
  CONFLICT_MESSAGE,
  deleteButton,
  dialog,
  executeGraphQL,
  failure,
  found,
  LOCK_MESSAGE,
  LOCKED_PLAN,
  main,
  ok,
  pageTitle,
  PRODUCT,
  productWith,
  renderEditProduct,
  respond,
} from './edit-product-fixtures.tsx';
import { passBotCheck } from './settings-fixtures.ts';

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const DIALOG_TITLE = 'プロダクト『Pitch Notes』を削除しますか?';
const DIALOG_DESCRIPTION =
  'ローンチ予定と過去のローンチの記録が削除され、元に戻せません。';

const noticeOf = (id: string, order: number): ProductDeleteNotice => ({
  id,
  order,
  component: ({ productHandle }) => (
    <p>{`${id}の注意書き: ${productHandle}`}</p>
  ),
});

const FAILING_NOTICE: ProductDeleteNotice = {
  id: 'test.failing',
  order: 20,
  component: () => {
    throw new Error('注意書きの描画に失敗しました。');
  },
};

const confirmButton = () =>
  dialog().getByRole('button', { name: '削除', exact: true });

beforeEach(async () => {
  await page.viewport(1280, 900);
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(async () => {
  vi.useRealTimers();
  await emulateBrowserDisplay(null);
  toast.dismiss();
  applyColorScheme('light');
});

describe('プロダクトの削除', () => {
  test('確認のダイアログに名称と削除の結果を示し、登録した注意書きをorderの順に個別に描き、キャンセルで閉じる', async () => {
    respond();
    await renderEditProduct({
      registrations: {
        deleteNotices: [
          noticeOf('test.later', 30),
          FAILING_NOTICE,
          noticeOf('test.first', 10),
        ],
      },
    });

    await userEvent.click(deleteButton());

    await expect
      .element(dialog().getByRole('heading', { name: DIALOG_TITLE }))
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(DIALOG_DESCRIPTION);
    const first = dialog().getByText('test.firstの注意書き: pitch-notes');
    const later = dialog().getByText('test.laterの注意書き: pitch-notes');
    await expect.element(first).toBeVisible();
    await expect.element(later).toBeVisible();
    await expect.element(dialog().getByRole('alert')).toBeVisible();
    expect(
      first.element().compareDocumentPosition(later.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'product_delete',
      size: 'invisible',
    });

    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(deleteButton()).toHaveFocus();
    expect(callsOf(ClientDeleteProductDocument)).toHaveLength(0);
  });

  test('bot対策のトークンと読み込んだ版を添えて削除し、成功すると削除した旨を示して自分のプロダクトの一覧へ戻る', async () => {
    respond();
    const router = await renderEditProduct();

    await userEvent.click(deleteButton());
    passBotCheck();
    await userEvent.click(confirmButton());

    await expect
      .element(page.getByText('プロダクトを削除しました。'))
      .toBeVisible();
    await expect.element(pageTitle()).toHaveTextContent('自分のプロダクト');
    expect(router.state.location.pathname).toBe('/my/products');
    expect(callsOf(ClientDeleteProductDocument)).toEqual([
      [
        ClientDeleteProductDocument,
        { productHandle: 'pitch-notes', expectedVersion: PRODUCT.version },
        { turnstileToken: 'turnstile-token-1' },
      ],
    ]);
  });

  test('別の画面での変更で版が競合した削除は、プロダクトを取り直し、再試行で取り直した版を送って削除できる', async () => {
    let latest = PRODUCT;
    respond({
      myProduct: () => found(latest),
      remove: () => {
        if (latest === PRODUCT) {
          latest = productWith({ tagline: '別の画面のタグライン', version: 4 });
          return failure({
            code: 'product_update_conflict',
            message: CONFLICT_MESSAGE,
            status: 409,
          });
        }
        return ok({ deleteProduct: true });
      },
    });
    const router = await renderEditProduct();
    const lookupsBefore = callsOf(ClientMyProductDocument).length;

    await userEvent.click(deleteButton());
    passBotCheck();
    await userEvent.click(confirmButton());

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(CONFLICT_MESSAGE);
    await expect
      .poll(() => callsOf(ClientMyProductDocument).length)
      .toBeGreaterThan(lookupsBefore);

    passBotCheck();
    await userEvent.click(confirmButton());

    await expect
      .element(page.getByText('プロダクトを削除しました。'))
      .toBeVisible();
    expect(router.state.location.pathname).toBe('/my/products');
    expect(
      callsOf(ClientDeleteProductDocument).map(([, variables]) => variables),
    ).toEqual([
      { productHandle: 'pitch-notes', expectedVersion: 3 },
      { productHandle: 'pitch-notes', expectedVersion: 4 },
    ]);
  });

  test('画面を開いた後に固定の期間に入っていた削除は、理由をダイアログに示し、プロダクトを取り直して削除のボタンを無効にする', async () => {
    let locked = false;
    respond({
      myProduct: () =>
        found(locked ? productWith({ plan: LOCKED_PLAN }) : PRODUCT),
      remove: () => {
        locked = true;
        return failure({
          code: 'product_locked',
          message: LOCK_MESSAGE,
          status: 409,
        });
      },
    });
    const router = await renderEditProduct();
    const lookupsBefore = callsOf(ClientMyProductDocument).length;

    await userEvent.click(deleteButton());
    passBotCheck();
    await userEvent.click(confirmButton());

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(LOCK_MESSAGE);
    await expect
      .poll(() => callsOf(ClientMyProductDocument).length)
      .toBeGreaterThan(lookupsBefore);
    expect(router.state.location.pathname).toBe(
      '/my/products/pitch-notes/edit',
    );

    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));

    await expect
      .element(deleteButton())
      .toHaveAccessibleDescription(LOCK_MESSAGE);
    expect(main().getByRole('dialog').query()).toBeNull();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、削除の確認のダイアログの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      respond();
      await renderEditProduct({
        registrations: { deleteNotices: [noticeOf('test.first', 10)] },
      });

      await userEvent.click(deleteButton());
      await expect.element(dialog()).toBeVisible();

      expect(await runAxe(document.body)).toEqual([]);
    },
  );
});
