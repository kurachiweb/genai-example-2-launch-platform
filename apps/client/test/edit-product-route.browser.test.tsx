import { notifyManager } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import type { MyProductSection } from '../src/components/product/product-section-types.ts';
import { BOUNDARY_REFRESH_DELAY_MS } from '../src/components/product/use-boundary-refresh.ts';
import {
  ClientMyProductDocument,
  ClientUpdateProductDocument,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as EditProductRoute } from '../src/routes/_authenticated/my/products/$handle/edit.tsx';
import {
  callsOf,
  categorySelect,
  CONFLICT_MESSAGE,
  deleteButton,
  EDIT_PATH,
  executeGraphQL,
  failure,
  form,
  found,
  LOCK_MESSAGE,
  LOCK_UNKNOWN_REASON,
  LOCKED_PLAN,
  main,
  type MyProductPlan,
  ok,
  PAIRING_AT,
  pageTitle,
  PRODUCT,
  productWith,
  renderEditProduct,
  respond,
  saveButton,
  statusSection,
  textbox,
  updateInputOf,
} from './edit-product-fixtures.tsx';
import { passBotCheck } from './settings-fixtures.ts';
import { signedInViewerQuery } from './viewer-fixtures.ts';

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

const HIDDEN_NOTICE =
  'このプロダクトは公開が停止されています。内容を直したら、お問い合わせから確認を依頼してください。';
const SUSPENDED_NOTICE =
  'このアカウントは停止されているため、プロダクトは登録・変更できません。';

const LOADED_FIELDS = {
  name: 'Pitch Notes',
  tagline: 'ピッチの台本を整える',
  categoryId: '01JD0CATEGORY0000000000001',
  handle: 'pitch-notes',
  websiteUrl: 'https://pitch.example/',
  description: '台本を整える道具です。',
  logoFileId: '01JD0FILE0000000000000L0G0',
  screenshotFileIds: ['01JD0FILE00000000000000002'],
} as const;

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

const sectionOf = (id: string, order: number): MyProductSection => ({
  id,
  order,
  component: ({ product }) => (
    <p>{`${id}: ${product.productHandle} ${product.productName} ${String(product.hidden)} ${product.placement}`}</p>
  ),
});

async function saveTagline(tagline: string): Promise<void> {
  await expect.element(textbox('タグライン(必須)')).toBeEnabled();
  await userEvent.fill(textbox('タグライン(必須)'), tagline);
  passBotCheck();
  await userEvent.click(saveButton());
}

beforeEach(async () => {
  await page.viewport(1280, 900);
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  await emulateBrowserDisplay(null);
  toast.dismiss();
  applyColorScheme('light');
});

describe('プロダクトの編集画面の経路', () => {
  test('ページのタイトルは「<名称>を編集」で、検索エンジンに登録させない', () => {
    const head = EditProductRoute.options.head as
      | ((context: {
          readonly loaderData: { readonly name: string };
        }) => ReturnType<typeof buildSitePageHead>)
      | undefined;
    const meta = head?.({ loaderData: { name: 'Pitch Notes' } }).meta ?? [];

    expect(meta).toContainEqual({
      title: 'Pitch Notesを編集 | Launch Stadium',
    });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  test('一覧の「編集」から開くと、現在の内容を入れたフォームと状態の区画を示す', async () => {
    respond();
    const router = await renderEditProduct({ path: '/my/products' });

    await userEvent.click(
      main().getByRole('link', { name: 'Pitch Notesを編集' }),
    );

    await expect.element(pageTitle()).toHaveTextContent('Pitch Notesを編集');
    expect(router.state.location.pathname).toBe(EDIT_PATH);
    await expect.element(textbox('名称(必須)')).toHaveValue('Pitch Notes');
    await expect.element(textbox('ハンドル(必須)')).toHaveValue('pitch-notes');
    await expect
      .element(statusSection().getByText('キックオフ予定'))
      .toBeVisible();
    await expect.element(form().getByText('1/20枚・2MB/10MB')).toBeVisible();
    expect(
      statusSection().getByText('ローンチ日は編集画面で変更できます。').query(),
    ).toBeNull();
  });

  test('他人・論理削除済み・不在のプロダクトは存在しないページを示す', async () => {
    respond({ myProduct: () => ({ myProduct: null }) });
    await renderEditProduct();

    await expect
      .element(main().getByText('ページが見つかりません', { exact: false }))
      .toBeVisible();
    expect(form().query()).toBeNull();
  });

  test('旧ハンドルで開くと、現在のハンドルの編集画面へ移す', async () => {
    respond({
      myProduct: (handle) =>
        handle === 'pitch-notes-old'
          ? {
              myProduct: {
                __typename: 'MyProductRedirect',
                handle: 'pitch-notes',
              },
            }
          : found(PRODUCT),
    });
    const router = await renderEditProduct({
      path: '/my/products/pitch-notes-old/edit',
    });

    await expect.element(pageTitle()).toHaveTextContent('Pitch Notesを編集');
    expect(router.state.location.pathname).toBe(EDIT_PATH);
  });

  test('非公開化中は、状態の区画に問い合わせへの導線を添えた案内を示し、内容を編集できる', async () => {
    respond({ myProduct: () => found(productWith({ hidden: true })) });
    await renderEditProduct();

    await expect
      .element(statusSection().getByText(HIDDEN_NOTICE))
      .toBeVisible();
    await expect
      .element(statusSection().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect.element(textbox('名称(必須)')).toBeEnabled();
    await expect.element(deleteButton()).toBeEnabled();
  });

  test('登録した区画を状態の区画にorderの順で並べ、1つの区画の失敗が他の区画を止めない', async () => {
    respond();
    await renderEditProduct({
      registrations: {
        sections: [
          sectionOf('test.later', 30),
          {
            id: 'test.failing',
            order: 20,
            component: () => {
              throw new Error('区画の描画に失敗しました。');
            },
          },
          sectionOf('test.first', 10),
        ],
      },
    });

    const first = statusSection().getByText(
      'test.first: pitch-notes Pitch Notes false edit',
    );
    const later = statusSection().getByText(
      'test.later: pitch-notes Pitch Notes false edit',
    );
    await expect.element(first).toBeVisible();
    await expect.element(later).toBeVisible();
    await expect.element(statusSection().getByRole('alert')).toBeVisible();
    expect(
      first.element().compareDocumentPosition(later.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('停止中の利用者には停止中の案内を示し、全欄と送信と削除を無効にする', async () => {
    respond();
    await renderEditProduct({
      viewer: signedInViewerQuery({ status: 'SUSPENDED' }),
    });

    await expect
      .element(main().getByRole('note', { name: '停止中のアカウント' }))
      .toHaveTextContent(SUSPENDED_NOTICE);
    await expect.element(textbox('名称(必須)')).toBeDisabled();
    await expect.element(saveButton()).toBeDisabled();
    await expect.element(deleteButton()).toBeDisabled();
  });
});

describe('保存', () => {
  test('読み込んだハンドルと版を添えて保存し、保存した旨を示す', async () => {
    respond({
      update: () =>
        ok({
          updateProduct: productWith({
            tagline: '新しいタグライン',
            version: 4,
          }),
        }),
    });
    const router = await renderEditProduct();

    await saveTagline('新しいタグライン');

    await expect.element(page.getByText('変更を保存しました。')).toBeVisible();
    expect(router.state.location.pathname).toBe(EDIT_PATH);
    expect(updateInputOf()).toEqual({
      input: {
        productHandle: 'pitch-notes',
        expectedVersion: 3,
        fields: { ...LOADED_FIELDS, tagline: '新しいタグライン' },
        launchDate: '2026-11-20',
      },
    });
    expect(
      (callsOf(ClientUpdateProductDocument)[0] as readonly unknown[])[2],
    ).toEqual({ turnstileToken: 'turnstile-token-1' });
  });

  test('ハンドルを変えた保存の成功で、新しいハンドルの編集画面のURLへ置き換える', async () => {
    const renamed = productWith({
      handle: 'pitch-deck',
      previousHandle: 'pitch-notes',
      version: 4,
    });
    respond({
      myProduct: (handle) =>
        handle === 'pitch-deck' ? found(renamed) : found(PRODUCT),
      update: () => ok({ updateProduct: renamed }),
    });
    const router = await renderEditProduct();
    const historyLength = router.history.length;
    await expect.element(textbox('ハンドル(必須)')).toBeEnabled();

    await userEvent.fill(textbox('ハンドル(必須)'), 'pitch-deck');
    passBotCheck();
    await userEvent.click(saveButton());

    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/my/products/pitch-deck/edit');
    expect(router.history.length).toBe(historyLength);
    await expect.element(textbox('ハンドル(必須)')).toHaveValue('pitch-deck');
    await expect
      .element(form().getByText(/^以前のハンドルpitch-notesは/u))
      .toBeVisible();
  });

  test('版の競合は最新の内容を読み込む案内を示し、プロダクトを取り直し、読み込むと最新の内容でフォームを作り直す', async () => {
    let latest = PRODUCT;
    respond({
      myProduct: () => found(latest),
      update: () => {
        latest = productWith({ tagline: '別の画面のタグライン', version: 4 });
        return failure({
          code: 'product_update_conflict',
          message: CONFLICT_MESSAGE,
          status: 409,
        });
      },
    });
    await renderEditProduct();
    const lookupsBefore = callsOf(ClientMyProductDocument).length;

    await saveTagline('この画面のタグライン');

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(CONFLICT_MESSAGE);
    await expect
      .poll(() => callsOf(ClientMyProductDocument).length)
      .toBeGreaterThan(lookupsBefore);
    await expect.element(saveButton()).toBeEnabled();

    await userEvent.click(
      form().getByRole('button', { name: '最新の内容を読み込む' }),
    );

    await expect
      .element(textbox('タグライン(必須)'))
      .toHaveValue('別の画面のタグライン');
    await expect.element(pageTitle()).toHaveFocus();
    expect(form().getByRole('alert').query()).toBeNull();
  });

  test('選んだ日が選べなくなっていた保存は、その文言をローンチ日の欄に示し、プロダクトと選べる日を取り直す', async () => {
    const message = 'ローンチ日は11月11日〜2027年2月7日の間で選んでください。';
    respond({
      update: () =>
        failure({
          code: 'launch_date_unavailable',
          message,
          status: 422,
          details: [
            { field: 'input.launchDate', code: 'out_of_range', message },
          ],
        }),
    });
    await renderEditProduct();
    const lookupsBefore = callsOf(ClientMyProductDocument).length;

    await saveTagline('新しいタグライン');

    await expect.element(form().getByText(message)).toBeVisible();
    await expect
      .poll(() => callsOf(ClientMyProductDocument).length)
      .toBeGreaterThan(lookupsBefore);
  });
});

describe('マッチ直前・マッチ中の固定の期間', () => {
  test('カテゴリとローンチ日と削除を理由とともに無効にし、他の欄は編集でき、読み込んだカテゴリとnullのローンチ日を送る', async () => {
    respond({ myProduct: () => found(productWith({ plan: LOCKED_PLAN })) });
    await renderEditProduct();

    await expect.element(categorySelect()).toBeDisabled();
    await expect
      .element(categorySelect())
      .toHaveAccessibleDescription(LOCK_MESSAGE);
    expect(form().getByRole('grid').query()).toBeNull();
    await expect.element(deleteButton()).toBeDisabled();
    await expect
      .element(deleteButton())
      .toHaveAccessibleDescription(LOCK_MESSAGE);

    await saveTagline('新しいタグライン');

    await expect
      .poll(() => callsOf(ClientUpdateProductDocument))
      .toHaveLength(1);
    expect(updateInputOf()).toEqual({
      input: {
        productHandle: 'pitch-notes',
        expectedVersion: 3,
        fields: { ...LOADED_FIELDS, tagline: '新しいタグライン' },
        launchDate: null,
      },
    });
  });

  test('無効にしたカテゴリの欄へのサーバーの詳細はフォーム全体の失敗として示し、送信ボタンを無効のまま残さない', async () => {
    const message = 'カテゴリをもう一度選択してください。';
    respond({
      myProduct: () => found(productWith({ plan: LOCKED_PLAN })),
      update: () =>
        failure({
          code: 'category_not_found',
          message,
          status: 422,
          details: [
            { field: 'input.fields.categoryId', code: 'not_found', message },
          ],
        }),
    });
    await renderEditProduct();

    await saveTagline('新しいタグライン');

    await expect.element(form().getByRole('alert')).toHaveTextContent(message);
    await expect.element(saveButton()).toBeEnabled();
  });

  test.each<readonly [string, MyProductPlan, string | undefined]>([
    ['予約できない', { ...LOCKED_PLAN, locked: false, locks: [] }, undefined],
    [
      '判定に失敗した',
      { ...LOCKED_PLAN, mode: 'UNKNOWN', blocks: [], locked: false, locks: [] },
      undefined,
    ],
    [
      '固定を判定できない',
      { ...PRODUCT.plan, lockUnknown: true },
      LOCK_UNKNOWN_REASON,
    ],
  ])(
    '%s計画では、ローンチ日の欄を描かずnullのローンチ日を送る',
    async (_label, plan, reason) => {
      respond({ myProduct: () => found(productWith({ plan })) });
      await renderEditProduct();
      await expect.element(textbox('名称(必須)')).toBeEnabled();

      expect(form().getByRole('grid').query()).toBeNull();
      if (reason !== undefined) {
        await expect.element(categorySelect()).toBeDisabled();
        await expect
          .element(deleteButton())
          .toHaveAccessibleDescription(reason);
      }
      await saveTagline('新しいタグライン');

      await expect
        .poll(() => callsOf(ClientUpdateProductDocument))
        .toHaveLength(1);
      expect(updateInputOf()).toMatchObject({ input: { launchDate: null } });
    },
  );

  test('表示中に23:45を越えると取り直して固定へ切り替え、フォーカスのある削除のボタンはフォーカスが離れるまでaria-disabledにする', async () => {
    notifyManager.setScheduler(queueMicrotask);
    let locked = false;
    respond({
      myProduct: () =>
        found(locked ? productWith({ plan: LOCKED_PLAN }) : PRODUCT),
    });
    await renderEditProduct({
      now: new Date(PAIRING_AT.getTime() - 60_000),
      fakeTimers: ['Date', 'setTimeout', 'clearTimeout'],
    });
    await expect.element(deleteButton()).toBeEnabled();
    deleteButton().element().focus();
    const lookupsBefore = callsOf(ClientMyProductDocument).length;

    locked = true;
    await vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_REFRESH_DELAY_MS - 1);
    expect(callsOf(ClientMyProductDocument)).toHaveLength(lookupsBefore);
    await vi.advanceTimersByTimeAsync(1);

    await expect.element(categorySelect()).toBeDisabled();
    await expect
      .element(deleteButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(deleteButton()).toHaveFocus();
    expect(deleteButton().element()).not.toHaveAttribute('disabled');

    await userEvent.click(deleteButton(), { force: true });
    expect(page.getByRole('dialog').query()).toBeNull();

    await userEvent.tab();

    await expect.element(deleteButton()).toBeDisabled();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、編集画面の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      respond({ myProduct: () => found(productWith({ hidden: true })) });
      await renderEditProduct();
      await expect
        .element(
          form()
            .getByRole('toolbar', { name: '書式' })
            .getByRole('button', { name: '太字', exact: true }),
        )
        .not.toHaveAttribute('disabled');

      expect(await runAxe(document.body)).toEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sで、固定の期間の編集画面の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      respond({ myProduct: () => found(productWith({ plan: LOCKED_PLAN })) });
      await renderEditProduct();
      await expect.element(categorySelect()).toBeDisabled();

      expect(await runAxe(document.body)).toEqual([]);
    },
  );
});
