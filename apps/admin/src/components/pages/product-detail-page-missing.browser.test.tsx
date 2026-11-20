import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  MODERATION_DISPLAY,
  MODERATION_REASON,
} from '../../../test/moderation-fixtures.ts';
import {
  HIDDEN_PRODUCT_DETAIL,
  type ProductDetailHandler,
  productDetailOf,
  renderProductDetailPage,
  respondProductDetailGraphQL,
} from '../../../test/moderation-product-detail-fixtures.ts';
import { buttonBehindDialog } from '../../../test/moderation-render.tsx';
import {
  AdminHideProductDocument,
  AdminProductDocument,
  type AdminProductQuery,
  AdminQuarantineImageDocument,
  AdminUnhideProductDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

type ProductDetail = NonNullable<AdminProductQuery['adminProduct']>;

const PRODUCT_NOT_FOUND = 'プロダクトが見つかりません。';

const IMAGE_NOT_FOUND = '画像が見つかりません。';

const main = () => page.getByRole('main');
const sectionOf = (name: string) =>
  main().getByRole('region', { name, exact: true });
const notFoundRegion = () =>
  main().getByRole('region', { name: PRODUCT_NOT_FOUND, exact: true });
const buttonOf = (name: string) =>
  main().getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog');
const reasonBox = (name: string) =>
  dialog().getByRole('textbox', { name, exact: true });

const notFoundFailure = (code: string, message: string) =>
  failure({ code, message, status: 404 });

// 措置が拒否されたら、詳細の照会の応答を消えた後の状態に替える
const renderWithVanishing = async ({
  detail,
  vanished,
  action,
  failureOf,
}: {
  readonly detail: ProductDetail;
  readonly vanished: ProductDetail | null;
  readonly action: unknown;
  readonly failureOf: () => Promise<unknown>;
}) => {
  let missing = false;
  respondProductDetailGraphQL(executeGraphQL, {
    role: 'MODERATOR',
    handlers: new Map<unknown, ProductDetailHandler>([
      [
        AdminProductDocument,
        () => success({ adminProduct: missing ? vanished : detail }),
      ],
      [
        action,
        () => {
          missing = true;
          return failureOf();
        },
      ],
    ]),
  });
  await renderProductDetailPage('MODERATOR');
  await expect.element(main().getByRole('heading', { level: 1 })).toBeVisible();
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  await emulateBrowserDisplay(null);
});

describe('プロダクトが見つからない措置', () => {
  test.each([
    {
      name: '非公開化',
      detail: productDetailOf(),
      action: AdminHideProductDocument,
      confirmLabel: '非公開にする',
    },
    {
      name: '復元',
      detail: HIDDEN_PRODUCT_DETAIL,
      action: AdminUnhideProductDocument,
      confirmLabel: '復元する',
    },
  ])(
    '$nameの確定でプロダクトが見つからないと、ダイアログの中に文言を示して理由を保ち、閉じると見つからない表示に替えてその区画へフォーカスを移す',
    async ({ name, detail, action, confirmLabel }) => {
      await renderWithVanishing({
        detail,
        vanished: null,
        action,
        failureOf: () =>
          notFoundFailure('product_not_found', PRODUCT_NOT_FOUND),
      });

      await buttonOf(name).click();
      await reasonBox('理由(必須)').fill(MODERATION_REASON);
      await dialog().getByRole('button', { name: confirmLabel }).click();

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(PRODUCT_NOT_FOUND);
      await expect
        .element(reasonBox('理由(必須)'))
        .toHaveValue(MODERATION_REASON);
      await expect.element(buttonBehindDialog(name)).toBeInTheDocument();

      await dialog().getByRole('button', { name: 'キャンセル' }).click();

      await expect.element(dialog()).not.toBeInTheDocument();
      await expect.element(notFoundRegion()).toBeVisible();
      await expect.element(notFoundRegion()).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);
    },
  );

  test('区画の措置の確定でプロダクトごと消えていると、ダイアログの中に文言を示し、閉じると見つからない表示に替えてその区画へフォーカスを移す', async () => {
    await renderWithVanishing({
      detail: productDetailOf(),
      vanished: null,
      action: AdminQuarantineImageDocument,
      failureOf: () => notFoundFailure('image_not_found', IMAGE_NOT_FOUND),
    });

    await buttonOf('スクリーンショット1を隔離').click();
    await reasonBox('理由(任意)').fill('不適切な画像のため');
    await dialog().getByRole('button', { name: '隔離する' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(IMAGE_NOT_FOUND);
    await expect
      .element(reasonBox('理由(任意)'))
      .toHaveValue('不適切な画像のため');

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(notFoundRegion()).toHaveFocus();
  });
});

describe('画像が見つからない措置', () => {
  test('確定の時点で画像が見つからないと、ダイアログの中に文言を示して理由を保ち、閉じると詳細を取り直して画像の操作を除き、画像の区画の見出しへフォーカスを移す', async () => {
    const detail = productDetailOf();
    await renderWithVanishing({
      detail,
      vanished: { ...detail, screenshots: detail.screenshots.slice(1) },
      action: AdminQuarantineImageDocument,
      failureOf: () => notFoundFailure('image_not_found', IMAGE_NOT_FOUND),
    });

    await buttonOf('スクリーンショット1を隔離').click();
    await reasonBox('理由(任意)').fill('不適切な画像のため');
    await dialog().getByRole('button', { name: '隔離する' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(IMAGE_NOT_FOUND);
    await expect
      .element(reasonBox('理由(任意)'))
      .toHaveValue('不適切な画像のため');

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(buttonOf('スクリーンショット1を隔離'))
      .not.toBeInTheDocument();
    await expect.element(buttonOf('ロゴを隔離')).toBeVisible();
    await expect
      .element(sectionOf('画像').getByRole('heading', { level: 2 }))
      .toHaveFocus();
  });
});
