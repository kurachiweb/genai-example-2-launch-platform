import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { toMyProductView } from '../product/my-product-view.ts';
import type {
  MyProductLookup,
  MyProductsPage,
  MyProductsReader,
} from '../product/my-products-reader.ts';
import type { MyProductView } from '../product/ports.ts';
import type {
  ProductDescriptionEditor,
  ProductDescriptionUpdateRequest,
} from '../product/product-description-editor.ts';
import { PRODUCT_ERRORS, productError } from '../product/product-errors.ts';
import {
  PRODUCT_ID,
  snapshotOf,
} from '../product/testing/product-editor-fixtures.ts';
import { currentUserOf, stateOf } from '../product/testing/product-fakes.ts';
import {
  EditorOwnProductDescriptionService,
  OWN_PRODUCT_PAGE_SIZE,
} from './own-product-description-service.ts';

const USER = currentUserOf();

const viewOf = (overrides: Partial<MyProductView> = {}): MyProductView => ({
  ...toMyProductView(snapshotOf(), stateOf(PRODUCT_ID), USER.user),
  ...overrides,
});

const CURRENT = viewOf();

const UPDATED = viewOf({ descriptionMarkdown: '## 新しい説明文', version: 4 });

const PAGE: MyProductsPage = {
  nodes: [CURRENT],
  hasNextPage: true,
  endCursor: 'next-cursor',
};

const NOT_FOUND: MyProductLookup = { kind: 'not-found' };

const found = (product: MyProductView): MyProductLookup => ({
  kind: 'product',
  product,
});

interface SetupOptions {
  // findの呼び出しごとに順に返す。尽きたら最後の値を返し続ける
  readonly lookups?: readonly MyProductLookup[];
  readonly listFailure?: AppError;
  readonly editFailure?: AppError;
}

function setup(options: SetupOptions = {}) {
  const lookups = options.lookups ?? [found(CURRENT), found(UPDATED)];
  const finds: { user: CurrentUser; handle: string }[] = [];
  const lists: {
    user: CurrentUser;
    page: { readonly first: number; readonly after: string | undefined };
  }[] = [];
  const edits: {
    user: CurrentUser;
    input: ProductDescriptionUpdateRequest;
  }[] = [];
  const reader: MyProductsReader = {
    list: (user, page) => {
      lists.push({ user, page });
      return options.listFailure === undefined
        ? Promise.resolve(PAGE)
        : Promise.reject(options.listFailure);
    },
    find: (user, handle) => {
      const lookup =
        lookups[Math.min(finds.length, lookups.length - 1)] ?? NOT_FOUND;
      finds.push({ user, handle });
      return Promise.resolve(lookup);
    },
    newProductWindow: () => {
      throw new Error('呼ばれない');
    },
    ownerStatus: () => {
      throw new Error('呼ばれない');
    },
  };
  const editor: ProductDescriptionEditor = {
    update: (user, input) => {
      edits.push({ user, input });
      return options.editFailure === undefined
        ? Promise.resolve()
        : Promise.reject(options.editFailure);
    },
  };
  return {
    service: new EditorOwnProductDescriptionService(reader, editor),
    finds,
    lists,
    edits,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

describe('EditorOwnProductDescriptionService.list', () => {
  test('自分のプロダクトの読み取りに1ページ20件とカーソルを渡し、上流のページをそのまま返す', async () => {
    const { service, lists } = setup();

    const page = await service.list(USER, { after: 'cursor-1' });

    expect(OWN_PRODUCT_PAGE_SIZE).toBe(20);
    expect(lists).toEqual([
      { user: USER, page: { first: 20, after: 'cursor-1' } },
    ]);
    expect(page).toBe(PAGE);
  });

  test('カーソルの無い要求は最初のページを読む', async () => {
    const { service, lists } = setup();

    await service.list(USER, { after: undefined });

    expect(lists).toEqual([
      { user: USER, page: { first: 20, after: undefined } },
    ]);
  });

  test('上流の不正なカーソルの誤り(invalid_cursor)を変えずに返す', async () => {
    const failure = invalidCursorError();
    const { service } = setup({ listFailure: failure });

    expect(await rejectionOf(service.list(USER, { after: 'bad' }))).toBe(
      failure,
    );
  });
});

describe('EditorOwnProductDescriptionService.update', () => {
  test('現在のハンドルで説明文を保存し、読み直したプロダクトを返す', async () => {
    const { service, finds, edits } = setup();

    const result = await service.update(USER, {
      productHandle: CURRENT.handle,
      descriptionMarkdown: '## 新しい説明文',
    });

    expect(result).toBe(UPDATED);
    expect(edits).toEqual([
      {
        user: USER,
        input: {
          productHandle: CURRENT.handle,
          descriptionMarkdown: '## 新しい説明文',
        },
      },
    ]);
    expect(finds).toEqual([
      { user: USER, handle: CURRENT.handle },
      { user: USER, handle: CURRENT.handle },
    ]);
  });

  test('旧ハンドルの指定は現在のハンドルで読み直し、現在のハンドルで保存する', async () => {
    const { service, finds, edits } = setup({
      lookups: [
        { kind: 'redirect', handle: CURRENT.handle },
        found(CURRENT),
        found(UPDATED),
      ],
    });

    const result = await service.update(USER, {
      productHandle: 'launch-meter-old',
      descriptionMarkdown: '## 新しい説明文',
    });

    expect(result).toBe(UPDATED);
    expect(finds.map(({ handle }) => handle)).toEqual([
      'launch-meter-old',
      CURRENT.handle,
      CURRENT.handle,
    ]);
    expect(edits.map(({ input }) => input.productHandle)).toEqual([
      CURRENT.handle,
    ]);
  });

  test.each([
    ['見つからない', [NOT_FOUND]],
    [
      '旧ハンドルの転送先が読み直しで見つからない',
      [{ kind: 'redirect', handle: 'launch-meter' }, NOT_FOUND],
    ],
    [
      '旧ハンドルの転送先がさらに転送される',
      [
        { kind: 'redirect', handle: 'launch-meter' },
        { kind: 'redirect', handle: 'launch-meter-new' },
      ],
    ],
  ] satisfies [string, MyProductLookup[]][])(
    '%sプロダクトは保存を呼ばずにproduct_not_foundを返す',
    async (_name, lookups) => {
      const { service, edits } = setup({ lookups });

      const error = await rejectionOf(
        service.update(USER, {
          productHandle: 'launch-meter-old',
          descriptionMarkdown: '本文',
        }),
      );

      expect(error.code).toBe('product_not_found');
      expect(error.kind).toBe('not_found');
      expect(error.message).toBe(PRODUCT_ERRORS.product_not_found.message);
      expect(edits).toEqual([]);
    },
  );

  test('非公開化中のプロダクトは保存を呼ばずに、product-launchと同じ文言のproduct_hidden(409)を返す', async () => {
    const { service, edits } = setup({
      lookups: [found(viewOf({ hidden: true }))],
    });

    const error = await rejectionOf(
      service.update(USER, {
        productHandle: CURRENT.handle,
        descriptionMarkdown: '本文',
      }),
    );

    expect(error.code).toBe('product_hidden');
    expect(error.kind).toBe('conflict');
    expect(error.message).toBe(
      'このプロダクトは公開が停止されているため、説明文を更新できません。',
    );
    expect(error.message).toBe(PRODUCT_ERRORS.product_hidden.message);
    expect(edits).toEqual([]);
  });

  test('旧ハンドルの転送先が非公開化中でも、保存を呼ばずにproduct_hiddenを返す', async () => {
    const { service, edits } = setup({
      lookups: [
        { kind: 'redirect', handle: CURRENT.handle },
        found(viewOf({ hidden: true })),
      ],
    });

    const error = await rejectionOf(
      service.update(USER, {
        productHandle: 'launch-meter-old',
        descriptionMarkdown: '本文',
      }),
    );

    expect(error.code).toBe('product_hidden');
    expect(edits).toEqual([]);
  });

  test.each([
    ['product_hidden', productError('product_hidden')],
    ['product_not_found', productError('product_not_found')],
    ['account_unavailable', productError('account_unavailable')],
  ])('事前の判定の後に保存が投げた%sを変えずに返す', async (_code, failure) => {
    const { service, finds } = setup({ editFailure: failure });

    const error = await rejectionOf(
      service.update(USER, {
        productHandle: CURRENT.handle,
        descriptionMarkdown: '本文',
      }),
    );

    expect(error).toBe(failure);
    expect(finds).toHaveLength(1);
  });

  test('保存の後の読み直しで見つからなければproduct_not_foundを返す', async () => {
    const { service, edits } = setup({
      lookups: [found(CURRENT), NOT_FOUND],
    });

    const error = await rejectionOf(
      service.update(USER, {
        productHandle: CURRENT.handle,
        descriptionMarkdown: '本文',
      }),
    );

    expect(error.code).toBe('product_not_found');
    expect(edits).toHaveLength(1);
  });
});
