import { describe, expect, test } from 'bun:test';

import type { HelpAuthorLookup, HelpAuthorView } from './help-authors.ts';
import { StoreHelpArticleAdminReader } from './help-article-admin-reader.ts';
import type {
  HelpArticleListRecord,
  HelpArticleRecord,
  HelpArticleStore,
} from './ports.ts';
import {
  ARTICLE,
  ARTICLE_ID,
  AUTHOR_ADMIN_ID,
  listRecordOf,
} from './testing/help-article-editor-fixtures.ts';

const OTHER_AUTHOR_ID = '01JBX8Y4Z5AUTHOR000000000B';
const DELETED_AUTHOR_ID = '01JBX8Y4Z5AUTHOR000000000C';
const OTHER_ARTICLE_ID = '01JD0HART00000000000000002';

const AUTHOR: HelpAuthorView = Object.freeze({
  nickname: 'サポートの山田',
  title: 'カスタマーサポート',
  avatarFileId: '01JBX8Y4Z5AVATAR000000000A',
});

const OTHER_AUTHOR: HelpAuthorView = Object.freeze({
  nickname: '運営の佐藤',
  title: null,
  avatarFileId: null,
});

const AUTHORS: ReadonlyMap<string, HelpAuthorView> = new Map([
  [AUTHOR_ADMIN_ID, AUTHOR],
  [OTHER_AUTHOR_ID, OTHER_AUTHOR],
]);

// 旧ハンドルを持つ編集中の記事
const EDITING: HelpArticleRecord = Object.freeze({
  ...ARTICLE,
  handle: 'reset-password',
  previousHandle: 'Old-Reset',
});

const at = (value: string): Date => new Date(value);

interface ReaderFakeOptions {
  readonly articles?: readonly HelpArticleRecord[];
  readonly listed?: readonly HelpArticleListRecord[];
  // 他の記事の現在のハンドル(大文字小文字を区別しない)
  readonly occupiedHandles?: readonly string[];
  // 旧ハンドル(大文字小文字を区別しない)とその保持者のID
  readonly previousHandleHolders?: readonly (readonly [string, string])[];
}

function setup(options: ReaderFakeOptions = {}) {
  const calls: string[] = [];
  const lookups: (readonly string[])[] = [];
  const occupancyChecks: (readonly [string, string | undefined])[] = [];
  const holderChecks: (readonly [string, string | undefined])[] = [];
  const articles = options.articles ?? [EDITING];
  const occupied = (options.occupiedHandles ?? []).map((handle) =>
    handle.toLowerCase(),
  );
  const holders = options.previousHandleHolders ?? [];
  const store: HelpArticleStore = {
    findById: (id) => {
      calls.push('findById');
      return Promise.resolve(articles.find((article) => article.id === id));
    },
    listAll: () => {
      calls.push('listAll');
      return Promise.resolve(options.listed ?? []);
    },
    isHandleOccupied: (handle, exceptArticleId) => {
      calls.push('isHandleOccupied');
      occupancyChecks.push([handle, exceptArticleId]);
      return Promise.resolve(occupied.includes(handle.toLowerCase()));
    },
    findPreviousHandleHolder: (handle, exceptArticleId) => {
      calls.push('findPreviousHandleHolder');
      holderChecks.push([handle, exceptArticleId]);
      return Promise.resolve(
        holders.find(
          ([previous, holderId]) =>
            previous.toLowerCase() === handle.toLowerCase() &&
            holderId !== exceptArticleId,
        )?.[1],
      );
    },
    create: () => Promise.reject(new Error('保存は呼ばれない想定です')),
    update: () => Promise.reject(new Error('保存は呼ばれない想定です')),
    delete: () => Promise.reject(new Error('削除は呼ばれない想定です')),
    reorder: () => Promise.reject(new Error('並べ替えは呼ばれない想定です')),
  };
  const authors: HelpAuthorLookup = {
    find: (adminIds) => {
      calls.push('findAuthors');
      lookups.push(adminIds);
      return Promise.resolve(
        new Map([...AUTHORS].filter(([adminId]) => adminIds.includes(adminId))),
      );
    },
  };
  return {
    reader: new StoreHelpArticleAdminReader(store, authors),
    calls,
    lookups,
    occupancyChecks,
    holderChecks,
  };
}

describe('StoreHelpArticleAdminReader.listAll', () => {
  test('下書きを含む全件を更新日時の新しい順に並べ、作成者を重複を除いて1回でまとめて引き、削除済みの作成者を空にする', async () => {
    const draft = listRecordOf('01JD0HART00000000000000001', {
      status: 'draft',
      updatedAt: at('2026-11-03T00:00:00.000Z'),
    });
    const listed = [
      draft,
      listRecordOf('01JD0HART00000000000000002', {
        createdByAdminId: DELETED_AUTHOR_ID,
        updatedAt: at('2026-11-05T00:00:00.000Z'),
      }),
      listRecordOf('01JD0HART00000000000000003', {
        createdByAdminId: OTHER_AUTHOR_ID,
        updatedAt: at('2026-11-01T00:00:00.000Z'),
      }),
      listRecordOf('01JD0HART00000000000000004', {
        updatedAt: at('2026-11-04T00:00:00.000Z'),
      }),
    ];
    const { reader, calls, lookups } = setup({ listed });

    const rows = await reader.listAll();

    expect(calls).toEqual(['listAll', 'findAuthors']);
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.toSorted()).toEqual(
      [AUTHOR_ADMIN_ID, DELETED_AUTHOR_ID, OTHER_AUTHOR_ID].toSorted(),
    );
    expect(rows.map(({ id, creator }) => [id.slice(-1), creator])).toEqual([
      ['2', null],
      ['4', AUTHOR],
      ['1', AUTHOR],
      ['3', OTHER_AUTHOR],
    ]);
    expect(rows[2]).toEqual({ ...draft, creator: AUTHOR });
  });

  test('更新日時が同じ記事はIDの新しい順に並べる', async () => {
    const updatedAt = at('2026-11-03T00:00:00.000Z');
    const { reader } = setup({
      listed: [
        listRecordOf('01JD0HART00000000000000001', { updatedAt }),
        listRecordOf('01JD0HART00000000000000003', { updatedAt }),
        listRecordOf('01JD0HART00000000000000002', { updatedAt }),
      ],
    });

    const rows = await reader.listAll();

    expect(rows.map(({ id }) => id.slice(-1))).toEqual(['3', '2', '1']);
  });

  test('記事が無ければ空の一覧を返す', async () => {
    const { reader } = setup({ listed: [] });

    expect(await reader.listAll()).toEqual([]);
  });

  test('作成者の照会が全員を削除済みとして返しても一覧を返す', async () => {
    const { reader } = setup({
      listed: [
        listRecordOf('01JD0HART00000000000000001', {
          createdByAdminId: DELETED_AUTHOR_ID,
        }),
      ],
    });

    const rows = await reader.listAll();

    expect(rows.map(({ creator }) => creator)).toEqual([null]);
  });
});

describe('StoreHelpArticleAdminReader.find', () => {
  test('1件の記事に作成者の表示用の情報を付けて返す', async () => {
    const { reader, lookups } = setup();

    const article = await reader.find(ARTICLE_ID);

    expect(article).toEqual({ ...EDITING, creator: AUTHOR });
    expect(lookups).toEqual([[AUTHOR_ADMIN_ID]]);
  });

  test('作成者が削除されていれば作成者を空にする', async () => {
    const { reader } = setup({
      articles: [{ ...EDITING, createdByAdminId: DELETED_AUTHOR_ID }],
    });

    const article = await reader.find(ARTICLE_ID);

    expect(article?.creator).toBeNull();
  });

  test('記事が無ければ作成者を引かずにundefinedを返す', async () => {
    const { reader, calls } = setup({ articles: [] });

    expect(await reader.find(ARTICLE_ID)).toBeUndefined();
    expect(calls).toEqual(['findById']);
  });
});

describe('StoreHelpArticleAdminReader.checkHandle', () => {
  test.each([
    ['空文字', ''],
    ['51文字', 'a'.repeat(51)],
    ['使えない文字', 'reset password'],
  ])('形式違反(%s)はストアを読まずにinvalidを返す', async (_label, handle) => {
    const { reader, calls } = setup();

    expect(await reader.checkHandle(handle, ARTICLE_ID)).toBe('invalid');
    expect(calls).toEqual([]);
  });

  test('50文字のハンドルは形式違反にしない', async () => {
    const { reader } = setup();

    expect(await reader.checkHandle('a'.repeat(50), undefined)).toBe(
      'available',
    );
  });

  test.each([
    ['現在のハンドル', 'reset-password'],
    ['現在のハンドルの大文字小文字だけの違い', 'Reset-Password'],
    ['保持中の旧ハンドル', 'old-reset'],
  ])(
    '編集中の記事自身の%sは使用中を判定せずavailableを返す',
    async (_label, handle) => {
      const { reader, calls } = setup({
        occupiedHandles: [handle],
        previousHandleHolders: [[handle, OTHER_ARTICLE_ID]],
      });

      expect(await reader.checkHandle(handle, ARTICLE_ID)).toBe('available');
      expect(calls).toEqual(['findById']);
    },
  );

  test('他の記事の現在のハンドルは記事自身を除いて判定しunavailableを返す', async () => {
    const { reader, occupancyChecks, holderChecks } = setup({
      occupiedHandles: ['billing'],
    });

    expect(await reader.checkHandle('Billing', ARTICLE_ID)).toBe('unavailable');
    expect(occupancyChecks).toEqual([['Billing', ARTICLE_ID]]);
    expect(holderChecks).toEqual([]);
  });

  test('他の記事の旧ハンドルは解放を伴って使えるavailable-releases-previousを返す', async () => {
    const { reader, holderChecks } = setup({
      previousHandleHolders: [['old-billing', OTHER_ARTICLE_ID]],
    });

    expect(await reader.checkHandle('Old-Billing', ARTICLE_ID)).toBe(
      'available-releases-previous',
    );
    expect(holderChecks).toEqual([['Old-Billing', ARTICLE_ID]]);
  });

  test('作成の画面では記事を読まずに全ての記事を対象に判定する', async () => {
    const { reader, calls, occupancyChecks } = setup({
      occupiedHandles: ['reset-password'],
      previousHandleHolders: [['old-reset', ARTICLE_ID]],
    });

    expect(await reader.checkHandle('reset-password', undefined)).toBe(
      'unavailable',
    );
    expect(await reader.checkHandle('old-reset', undefined)).toBe(
      'available-releases-previous',
    );
    expect(calls).not.toContain('findById');
    expect(occupancyChecks).toEqual([
      ['reset-password', undefined],
      ['old-reset', undefined],
    ]);
  });

  test('どの記事も使っていないハンドルはavailableを返す', async () => {
    const { reader } = setup();

    expect(await reader.checkHandle('new-guide', ARTICLE_ID)).toBe('available');
  });

  test('予約語の判定はしない', async () => {
    const { reader } = setup({ articles: [] });

    expect(await reader.checkHandle('admin', undefined)).toBe('available');
  });

  test('編集中の記事が削除されていれば全ての記事を対象に判定する', async () => {
    const { reader, occupancyChecks } = setup({ articles: [] });

    expect(await reader.checkHandle('guide', ARTICLE_ID)).toBe('available');
    expect(occupancyChecks).toEqual([['guide', undefined]]);
  });
});
