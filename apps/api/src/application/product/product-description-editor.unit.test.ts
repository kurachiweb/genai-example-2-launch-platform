import { describe, expect, test } from 'bun:test';

import type { ProductDescriptionUpdateResult } from './ports.ts';
import { StoreProductDescriptionEditor } from './product-description-editor.ts';
import {
  PRODUCT_ID,
  rejectionOf,
  snapshotOf,
} from './testing/product-editor-fixtures.ts';
import {
  createFakeProductStore,
  currentUserOf,
  type FakeProductStoreOptions,
  fixedClock,
  PRODUCT_NOW,
} from './testing/product-fakes.ts';

function setup(options: FakeProductStoreOptions = {}) {
  const calls: string[] = [];
  const store = createFakeProductStore(calls, {
    snapshots: [snapshotOf()],
    ...options,
  });
  const editor = new StoreProductDescriptionEditor(store, fixedClock);
  return { editor, store, calls };
}

describe('ProductDescriptionEditor.update', () => {
  test('本人のプロダクトを現在のハンドルで探し、説明文だけを現在の時刻で更新する', async () => {
    const { editor, store, calls } = setup();

    await editor.update(currentUserOf(), {
      productHandle: 'launch-meter',
      descriptionMarkdown: '# 新しい概要',
    });

    expect(calls).toEqual(['store.findForOwner', 'store.updateDescription']);
    expect(store.descriptionUpdates).toEqual([
      {
        productId: PRODUCT_ID,
        descriptionMarkdown: '# 新しい概要',
        now: PRODUCT_NOW,
      },
    ]);
  });

  test('本人のプロダクトが見つからなければ、product_not_foundで拒否し更新しない', async () => {
    const { editor, calls } = setup({ snapshots: [] });

    const error = await rejectionOf(
      editor.update(currentUserOf(), {
        productHandle: 'launch-meter',
        descriptionMarkdown: '# 新しい概要',
      }),
    );

    expect(error.code).toBe('product_not_found');
    expect(error.kind).toBe('not_found');
    expect(calls).toEqual(['store.findForOwner']);
  });

  test.each([
    ['空白だけ', ' \n', '説明文を入力してください。'],
    [
      '20,001文字',
      'あ'.repeat(20_001),
      '説明文は20,000文字以内で入力してください。',
    ],
    [
      '禁止文字を含む',
      '概要\u0000',
      '説明文に使用できない文字が含まれています。',
    ],
  ])(
    '%sの説明文は、画面と同じ規則の文言のvalidation_errorで拒否し更新しない',
    async (_, descriptionMarkdown, message) => {
      const { editor, store } = setup();

      const error = await rejectionOf(
        editor.update(currentUserOf(), {
          productHandle: 'launch-meter',
          descriptionMarkdown,
        }),
      );

      expect(error.code).toBe('validation_error');
      expect(error.kind).toBe('bad_request');
      expect(error.details).toEqual([
        { field: 'descriptionMarkdown', code: 'custom', message },
      ]);
      expect(store.descriptionUpdates).toEqual([]);
    },
  );

  test('20,000文字の説明文は受け付ける', async () => {
    const { editor, store } = setup();

    await editor.update(currentUserOf(), {
      productHandle: 'launch-meter',
      descriptionMarkdown: 'あ'.repeat(20_000),
    });

    expect(store.descriptionUpdates).toHaveLength(1);
  });

  test.each([
    [
      'hidden',
      'product_hidden',
      'conflict',
      'このプロダクトは公開が停止されているため、説明文を更新できません。',
    ],
    [
      'not-found',
      'product_not_found',
      'not_found',
      'プロダクトが見つかりません。',
    ],
    [
      'account-unavailable',
      'account_unavailable',
      'forbidden',
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
    ],
  ] as const satisfies readonly (readonly [
    Exclude<ProductDescriptionUpdateResult, 'saved'>,
    string,
    string,
    string,
  ])[])(
    '書き込みの時点のストアの結果が%sなら、%s(%s)で拒否する',
    async (result, code, kind, message) => {
      const { editor } = setup({ descriptionResult: result });

      const error = await rejectionOf(
        editor.update(currentUserOf(), {
          productHandle: 'launch-meter',
          descriptionMarkdown: '# 新しい概要',
        }),
      );

      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
      expect(error.message).toBe(message);
    },
  );

  test('非公開化中と読んだプロダクトでも事前には拒否せず、書き込みの時点の結果で判定する', async () => {
    const { editor, calls } = setup({
      snapshots: [snapshotOf({ hidden: true })],
      descriptionResult: 'hidden',
    });

    const error = await rejectionOf(
      editor.update(currentUserOf(), {
        productHandle: 'launch-meter',
        descriptionMarkdown: '# 新しい概要',
      }),
    );

    expect(error.code).toBe('product_hidden');
    expect(calls).toEqual(['store.findForOwner', 'store.updateDescription']);
  });
});
