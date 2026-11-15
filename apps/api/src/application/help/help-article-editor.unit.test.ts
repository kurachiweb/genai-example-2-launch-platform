import { describe, expect, test } from 'bun:test';

import { HELP_ARTICLE_SEARCH_TARGET_NAME } from './ports.ts';
import {
  ARTICLE,
  ARTICLE_CONFLICT,
  ARTICLE_ID,
  ARTICLE_NOT_FOUND,
  AUTHOR_ADMIN_ID,
  BILLING_ID,
  BODY_PHRASE,
  CURRENT,
  HANDLE_UNAVAILABLE,
  listRecordOf,
  NEW_ARTICLE_ID,
  NOW,
  PREPARE_REJECTION,
  REASON,
  rejectionOf,
  SAVE_FAILURES,
  setupEditor,
  SUBTITLE,
  summaryOf,
  TITLE,
  updateInputOf,
  USAGE_ID,
  writeOf,
} from './testing/help-article-editor-fixtures.ts';

// 送信の失敗は要求の部品が例外にしないため、例外になるのは未登録の検索対象など呼び出し側の誤りだけである
const REFRESH_MISUSE = new Error('検索対象が登録されていません');

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('例外で拒否される想定です');
    },
    (reason: unknown) => reason,
  );
}

const expectNoArticleText = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(TITLE);
  expect(serialized).not.toContain(SUBTITLE);
  expect(serialized).not.toContain(BODY_PHRASE);
};

describe('StoreHelpArticleEditor.create', () => {
  test('使用中の判定・監査ログの準備・保存・索引の更新の依頼の順に行い、作成者を記録した記事を返す', async () => {
    const {
      editor,
      calls,
      prepared,
      preparedEntries,
      writes,
      occupancyChecks,
      refreshes,
    } = setupEditor();

    const created = await editor.create(CURRENT, writeOf(), REASON);

    expect(calls).toEqual([
      'isHandleOccupied',
      'prepare',
      'create',
      'requestRefresh',
    ]);
    expect(occupancyChecks).toEqual([['reset-password', undefined]]);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'help-article.create',
        targetIds: [NEW_ARTICLE_ID],
        reason: REASON,
        detail: { status: 'published' },
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'create',
        input: {
          id: NEW_ARTICLE_ID,
          write: writeOf(),
          createdByAdminId: CURRENT.id,
          now: NOW,
          audit: preparedEntries[0],
        },
      },
    ]);
    expect(refreshes).toEqual([
      [HELP_ARTICLE_SEARCH_TARGET_NAME, NEW_ARTICLE_ID],
    ]);
    expect(created).toMatchObject({
      id: NEW_ARTICLE_ID,
      createdByAdminId: CURRENT.id,
      revision: 1,
    });
  });

  test('下書きの作成は索引の更新を依頼せず、監査ログの詳細に下書きを記録する', async () => {
    const { editor, calls, prepared } = setupEditor();

    await editor.create(CURRENT, writeOf({ status: 'draft' }), undefined);

    expect(calls).not.toContain('requestRefresh');
    expect(prepared[0]?.detail).toEqual({ status: 'draft' });
  });

  test('理由が無ければ監査ログの理由を渡さない', async () => {
    const { editor, prepared } = setupEditor();

    await editor.create(CURRENT, writeOf(), undefined);

    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test('ユーザー・プロダクトの予約語のハンドルも、使用中でなければ受け付ける', async () => {
    const { editor, calls, occupancyChecks } = setupEditor();

    const created = await editor.create(
      CURRENT,
      writeOf({ handle: 'admin' }),
      undefined,
    );

    expect(created.handle).toBe('admin');
    expect(occupancyChecks).toEqual([['admin', undefined]]);
    expect(calls).toContain('create');
  });

  test('他の記事の現在のハンドルと大文字小文字を区別せずに一致すれば、監査ログの準備と保存の前に拒否する', async () => {
    const { editor, calls } = setupEditor({
      occupiedHandles: ['reset-password'],
    });

    const error = await rejectionOf(
      editor.create(CURRENT, writeOf({ handle: 'Reset-Password' }), undefined),
    );

    expect(summaryOf(error)).toEqual(HANDLE_UNAVAILABLE);
    expect(calls).toEqual(['isHandleOccupied']);
  });

  test.each(SAVE_FAILURES)(
    '保存が%sを返せば対応するエラーにし、索引の更新を依頼しない',
    async (kind, expected) => {
      const { editor, calls } = setupEditor({ createResult: kind });

      const error = await rejectionOf(
        editor.create(CURRENT, writeOf(), undefined),
      );

      expect(summaryOf(error)).toEqual(expected);
      expect(calls).toEqual(['isHandleOccupied', 'prepare', 'create']);
    },
  );

  test('監査ログの準備が拒否すると保存しない', async () => {
    const { editor, calls } = setupEditor({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      editor.create(CURRENT, writeOf(), undefined),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['isHandleOccupied', 'prepare']);
  });

  test('監査ログにタイトル・サブタイトル・本文を含めない', async () => {
    const { editor, prepared } = setupEditor();

    await editor.create(CURRENT, writeOf(), REASON);

    expectNoArticleText(prepared);
  });

  test('索引の更新の依頼の部品が呼び出し側の誤りで例外を投げれば、保存の後でその例外をそのまま伝える', async () => {
    const { editor, calls } = setupEditor({ refreshError: REFRESH_MISUSE });

    const error = await thrownBy(editor.create(CURRENT, writeOf(), undefined));

    expect(error).toBe(REFRESH_MISUSE);
    expect(calls).toEqual([
      'isHandleOccupied',
      'prepare',
      'create',
      'requestRefresh',
    ]);
  });
});

describe('StoreHelpArticleEditor.update', () => {
  test('存在・版・使用中の判定・監査ログの準備・保存・索引の更新の依頼の順に行い、作成者を渡さずに保存する', async () => {
    const {
      editor,
      calls,
      prepared,
      preparedEntries,
      writes,
      occupancyChecks,
      refreshes,
    } = setupEditor({ articles: [{ ...ARTICLE, status: 'published' }] });

    const updated = await editor.update(
      CURRENT,
      updateInputOf({ handle: 'new-guide', status: 'published' }),
      REASON,
    );

    expect(calls).toEqual([
      'findById',
      'isHandleOccupied',
      'prepare',
      'update',
      'requestRefresh',
    ]);
    expect(occupancyChecks).toEqual([['new-guide', ARTICLE_ID]]);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'help-article.update',
        targetIds: [ARTICLE_ID],
        reason: REASON,
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'update',
        input: {
          id: ARTICLE_ID,
          expectedRevision: ARTICLE.revision,
          write: writeOf({ handle: 'new-guide', status: 'published' }),
          handleChange: {
            kind: 'changed',
            next: 'new-guide',
            previous: 'guide',
          },
          categoryChanged: false,
          now: NOW,
          audit: preparedEntries[0],
        },
      },
    ]);
    expect(refreshes).toEqual([[HELP_ARTICLE_SEARCH_TARGET_NAME, ARTICLE_ID]]);
    expect(updated).toMatchObject({
      handle: 'new-guide',
      previousHandle: 'guide',
      createdByAdminId: AUTHOR_ADMIN_ID,
      revision: ARTICLE.revision + 1,
    });
  });

  test('記事が無ければ、使用中の判定と監査ログの準備の前に記事の不在で拒否する', async () => {
    const { editor, calls } = setupEditor({ articles: [] });

    const error = await rejectionOf(
      editor.update(CURRENT, updateInputOf(), undefined),
    );

    expect(summaryOf(error)).toEqual(ARTICLE_NOT_FOUND);
    expect(calls).toEqual(['findById']);
  });

  test('版が違えば、使用中の判定と監査ログの準備の前に競合で拒否する', async () => {
    const { editor, calls } = setupEditor();

    const error = await rejectionOf(
      editor.update(
        CURRENT,
        updateInputOf({ handle: 'new-guide' }, ARTICLE.revision - 1),
        undefined,
      ),
    );

    expect(summaryOf(error)).toEqual(ARTICLE_CONFLICT);
    expect(calls).toEqual(['findById']);
  });

  test('別の文字列のハンドルが他の記事の現在のハンドルなら、監査ログの準備と保存の前に拒否する', async () => {
    const { editor, calls } = setupEditor({ occupiedHandles: ['billing'] });

    const error = await rejectionOf(
      editor.update(CURRENT, updateInputOf({ handle: 'Billing' }), undefined),
    );

    expect(summaryOf(error)).toEqual(HANDLE_UNAVAILABLE);
    expect(calls).toEqual(['findById', 'isHandleOccupied']);
  });

  test('ユーザー・プロダクトの予約語への変更も、使用中でなければ受け付ける', async () => {
    const { editor, occupancyChecks } = setupEditor();

    const updated = await editor.update(
      CURRENT,
      updateInputOf({ handle: 'admin' }),
      undefined,
    );

    expect(updated.handle).toBe('admin');
    expect(occupancyChecks).toEqual([['admin', ARTICLE_ID]]);
  });

  test('大文字小文字だけの変更は使用中を判定せず、表記だけの変更として保存する', async () => {
    const { editor, calls, writes } = setupEditor({
      occupiedHandles: ['guide'],
    });

    await editor.update(CURRENT, updateInputOf({ handle: 'Guide' }), undefined);

    expect(calls).not.toContain('isHandleOccupied');
    expect(writes[0]?.input).toMatchObject({
      handleChange: { kind: 'case-only', next: 'Guide' },
    });
  });

  test('現在のハンドルの維持は使用中を判定しない', async () => {
    const { editor, calls, writes } = setupEditor();

    await editor.update(CURRENT, updateInputOf(), undefined);

    expect(calls).not.toContain('isHandleOccupied');
    expect(writes[0]?.input).toMatchObject({ handleChange: { kind: 'none' } });
  });

  test('記事自身の旧ハンドルへの戻しは使用中を判定せずに受け付け、変更前のハンドルを新しい旧ハンドルにする', async () => {
    const { editor, calls, writes } = setupEditor({
      articles: [{ ...ARTICLE, previousHandle: 'old-guide' }],
    });

    const updated = await editor.update(
      CURRENT,
      updateInputOf({ handle: 'Old-Guide' }),
      undefined,
    );

    expect(calls).not.toContain('isHandleOccupied');
    expect(writes[0]?.input).toMatchObject({
      handleChange: { kind: 'changed', next: 'Old-Guide', previous: 'guide' },
    });
    expect(updated).toMatchObject({
      handle: 'Old-Guide',
      previousHandle: 'guide',
    });
  });

  test('カテゴリが変わったときだけカテゴリの変更として保存する', async () => {
    const changed = setupEditor();
    const kept = setupEditor();

    await changed.editor.update(
      CURRENT,
      updateInputOf({ categoryId: BILLING_ID }),
      undefined,
    );
    await kept.editor.update(
      CURRENT,
      updateInputOf({ pinned: true }),
      undefined,
    );

    expect(changed.writes[0]?.input).toMatchObject({ categoryChanged: true });
    expect(kept.writes[0]?.input).toMatchObject({ categoryChanged: false });
  });

  test('ステータスが変わったときだけ、監査ログの詳細に変更前後のステータスを記録する', async () => {
    const published = setupEditor();
    const unchanged = setupEditor();

    await published.editor.update(
      CURRENT,
      updateInputOf({ status: 'published' }),
      undefined,
    );
    await unchanged.editor.update(
      CURRENT,
      updateInputOf({ status: 'draft' }),
      undefined,
    );

    expect(published.prepared[0]?.detail).toEqual({
      fromStatus: 'draft',
      toStatus: 'published',
    });
    expect(unchanged.prepared[0]).not.toHaveProperty('detail');
  });

  test('公開から下書きへの変更と下書きのままの保存は索引の更新を依頼しない', async () => {
    const unpublished = setupEditor({
      articles: [{ ...ARTICLE, status: 'published' }],
    });
    const draft = setupEditor();

    await unpublished.editor.update(
      CURRENT,
      updateInputOf({ status: 'draft' }),
      undefined,
    );
    await draft.editor.update(CURRENT, updateInputOf(), undefined);

    expect(unpublished.prepared[0]?.detail).toEqual({
      fromStatus: 'published',
      toStatus: 'draft',
    });
    expect(unpublished.calls).not.toContain('requestRefresh');
    expect(draft.calls).not.toContain('requestRefresh');
  });

  test('公開の記事の保存は、ステータスが変わらなくても索引の更新を依頼する', async () => {
    const { editor, refreshes } = setupEditor({
      articles: [{ ...ARTICLE, status: 'published' }],
    });

    await editor.update(
      CURRENT,
      updateInputOf({ status: 'published', title: '新しいタイトル' }),
      undefined,
    );

    expect(refreshes).toEqual([[HELP_ARTICLE_SEARCH_TARGET_NAME, ARTICLE_ID]]);
  });

  test.each(SAVE_FAILURES)(
    '保存が%sを返せば対応するエラーにし、索引の更新を依頼しない',
    async (kind, expected) => {
      const { editor, calls } = setupEditor({ updateResult: kind });

      const error = await rejectionOf(
        editor.update(
          CURRENT,
          updateInputOf({ status: 'published' }),
          undefined,
        ),
      );

      expect(summaryOf(error)).toEqual(expected);
      expect(calls).toEqual(['findById', 'prepare', 'update']);
    },
  );

  test('監査ログの準備が拒否すると保存しない', async () => {
    const { editor, calls } = setupEditor({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      editor.update(CURRENT, updateInputOf(), undefined),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['findById', 'prepare']);
  });

  test('監査ログにタイトル・サブタイトル・本文を含めない', async () => {
    const { editor, prepared } = setupEditor();

    await editor.update(
      CURRENT,
      updateInputOf({ status: 'published' }),
      REASON,
    );

    expectNoArticleText(prepared);
  });

  test('索引の更新の依頼の部品が呼び出し側の誤りで例外を投げれば、保存の後でその例外をそのまま伝える', async () => {
    const { editor, calls } = setupEditor({ refreshError: REFRESH_MISUSE });

    const error = await thrownBy(
      editor.update(CURRENT, updateInputOf({ status: 'published' }), undefined),
    );

    expect(error).toBe(REFRESH_MISUSE);
    expect(calls).toEqual(['findById', 'prepare', 'update', 'requestRefresh']);
  });
});

describe('StoreHelpArticleEditor.delete', () => {
  test('存在の確認・監査ログの準備・削除の順に行い、索引の更新を依頼しない', async () => {
    const { editor, calls, prepared, preparedEntries, writes } = setupEditor();

    await editor.delete(CURRENT, { id: ARTICLE_ID, reason: REASON });

    expect(calls).toEqual(['findById', 'prepare', 'delete']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'help-article.delete',
        targetIds: [ARTICLE_ID],
        reason: REASON,
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'delete',
        input: { id: ARTICLE_ID, audit: preparedEntries[0] },
      },
    ]);
  });

  test('記事が既に無ければ、監査ログの準備の前に記事の不在で拒否する', async () => {
    const { editor, calls } = setupEditor({ articles: [] });

    const error = await rejectionOf(
      editor.delete(CURRENT, { id: ARTICLE_ID, reason: undefined }),
    );

    expect(summaryOf(error)).toEqual(ARTICLE_NOT_FOUND);
    expect(calls).toEqual(['findById']);
  });

  test('確認の後に別の画面で削除されていれば、記事の不在で拒否する', async () => {
    const { editor, calls } = setupEditor({ deleteResult: 'not-found' });

    const error = await rejectionOf(
      editor.delete(CURRENT, { id: ARTICLE_ID, reason: undefined }),
    );

    expect(summaryOf(error)).toEqual(ARTICLE_NOT_FOUND);
    expect(calls).toEqual(['findById', 'prepare', 'delete']);
  });
});

describe('StoreHelpArticleEditor.reorder', () => {
  const ORDERED_IDS = [
    '01JD0HART00000000000000003',
    '01JD0HART00000000000000001',
    '01JD0HART00000000000000002',
  ] as const;

  test('カテゴリを対象に件数を記録する監査ログを準備して並べ替え、そのカテゴリの記事をピン留めの群から並び順で返す', async () => {
    const pinned = listRecordOf(ORDERED_IDS[0], {
      pinned: true,
      sortOrder: 3,
    });
    const first = listRecordOf(ORDERED_IDS[1], { sortOrder: 1 });
    const second = listRecordOf(ORDERED_IDS[2], { sortOrder: 2 });
    const elsewhere = listRecordOf('01JD0HART00000000000000009', {
      categoryId: BILLING_ID,
      sortOrder: 1,
    });
    const { editor, calls, prepared, preparedEntries, writes } = setupEditor({
      listed: [second, elsewhere, first, pinned],
    });

    const result = await editor.reorder(CURRENT, {
      categoryId: USAGE_ID,
      orderedIds: ORDERED_IDS,
    });

    expect(result).toEqual([pinned, first, second]);
    expect(calls).toEqual(['prepare', 'reorder', 'listAll']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'help-article.reorder',
        targetIds: [USAGE_ID],
        detail: { count: '3' },
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'reorder',
        input: {
          categoryId: USAGE_ID,
          orderedIds: ORDERED_IDS,
          audit: preparedEntries[0],
        },
      },
    ]);
  });

  test('対象の集合が変わっていれば古い並びのエラーにし、一覧を読まない', async () => {
    const { editor, calls } = setupEditor({ reorderResult: 'outdated' });

    const error = await rejectionOf(
      editor.reorder(CURRENT, {
        categoryId: USAGE_ID,
        orderedIds: ORDERED_IDS,
      }),
    );

    expect(summaryOf(error)).toEqual({
      kind: 'conflict',
      code: 'help_order_outdated',
      details: undefined,
    });
    expect(calls).toEqual(['prepare', 'reorder']);
  });
});
