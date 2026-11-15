import { describe, expect, mock, test } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  directoryCategoriesQueryOptions,
  directoryInputOf,
  directoryQueryOfApplied,
  directoryQueryOptions,
  loadDirectory,
} from './directory.ts';
import {
  ClientDirectoryCategoriesDocument,
  ClientDirectoryDocument,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

describe('directoryInputOf', () => {
  test('指定された条件だけを入力にし、ページの番号は10進の文字列にする', () => {
    expect(
      directoryInputOf({
        q: 'ノート',
        category: 'developer-tools',
        from: '2026-09-01',
        to: '2026-09-30',
        sort: 'upvotes',
        page: 3,
      }),
    ).toStrictEqual({
      q: 'ノート',
      category: 'developer-tools',
      from: '2026-09-01',
      to: '2026-09-30',
      sort: 'upvotes',
      page: '3',
    });
  });

  test('既定の条件(undefined)の項目は入力に含めない', () => {
    expect(
      directoryInputOf({
        q: undefined,
        category: undefined,
        from: undefined,
        to: '2026-09-30',
        sort: undefined,
        page: undefined,
      }),
    ).toStrictEqual({ to: '2026-09-30' });
  });
});

describe('directoryQueryOptions', () => {
  test('本人のプロダクトの印を含むため、条件の入力のキーの後に閲覧者のIDか未ログインの印を加える', () => {
    const query = { sort: 'oldest', page: 2 } as const;

    expect([...directoryQueryOptions(query, VIEWER).queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientDirectoryDocument, {
        input: { sort: 'oldest', page: '2' },
      }),
      VIEWER.id,
    ]);
    expect([...directoryQueryOptions(query, null).queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientDirectoryDocument, {
        input: { sort: 'oldest', page: '2' },
      }),
      'guest',
    ]);
  });

  test('同じ条件は既定の項目の有無によらず同じキーになる', () => {
    expect(
      directoryQueryOptions({ q: 'ノート', page: undefined }, null).queryKey,
    ).toStrictEqual(directoryQueryOptions({ q: 'ノート' }, null).queryKey);
  });
});

describe('directoryCategoriesQueryOptions', () => {
  test('閲覧者によらない選択肢のため、共通の取得の補助のキーにする', () => {
    expect([...directoryCategoriesQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientDirectoryCategoriesDocument, {}),
    ]);
  });
});

describe('directoryQueryOfApplied', () => {
  test('サーバーが解決した条件を、URLの条件と同じ形(並び順は小文字)にする', () => {
    expect(
      directoryQueryOfApplied({
        q: 'ノート',
        category: 'developer-tools',
        from: '2026-09-01',
        to: '2026-09-30',
        sort: 'UPVOTES',
        page: 3,
      }),
    ).toStrictEqual({
      q: 'ノート',
      category: 'developer-tools',
      from: '2026-09-01',
      to: '2026-09-30',
      sort: 'upvotes',
      page: 3,
    });
  });

  test('値の無い項目は既定の条件(undefined)にする', () => {
    expect(
      directoryQueryOfApplied({
        q: null,
        category: null,
        from: null,
        to: null,
        sort: null,
        page: null,
      }),
    ).toStrictEqual({
      q: undefined,
      category: undefined,
      from: undefined,
      to: undefined,
      sort: undefined,
      page: undefined,
    });
  });
});

const QUERY = { q: 'ノート', page: 2 } as const;

const never = () => new Promise<never>(() => undefined);

describe('loadDirectory', () => {
  test('最初の表示では、一覧とカテゴリの選択肢を部品と同じ設定で同時に取得して待つ', async () => {
    const resolvers: (() => void)[] = [];
    const query = mock(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const queryClient = { query } as unknown as QueryClient;

    let loaded = false;
    const loading = loadDirectory({
      context: { queryClient, viewer: VIEWER },
      deps: QUERY,
      cause: 'enter',
    }).then(() => {
      loaded = true;
    });
    await Promise.resolve();

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: directoryQueryOptions(QUERY, VIEWER).queryKey,
        staleTime: 'static',
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: directoryCategoriesQueryOptions().queryKey,
        staleTime: 'static',
      }),
    );
    expect(loaded).toBe(false);

    for (const resolve of resolvers) {
      resolve();
    }
    await loading;

    expect(loaded).toBe(true);
  });

  test('取得に失敗しても、一覧の中で再試行できるよう例外にしない', async () => {
    const queryClient = {
      query: () => Promise.reject(new Error('取得の失敗')),
    } as unknown as QueryClient;

    const result = await loadDirectory({
      context: { queryClient, viewer: null },
      deps: QUERY,
      cause: 'enter',
    }).then(() => 'loaded');

    expect(result).toBe('loaded');
  });

  test('同じ画面の中の条件の変更では、直前の一覧を残して読み込み中を示せるよう、取得を始めるだけで待たない', async () => {
    const query = mock(never);
    const queryClient = { query } as unknown as QueryClient;

    const result = await loadDirectory({
      context: { queryClient, viewer: null },
      deps: QUERY,
      cause: 'stay',
    }).then(() => 'loaded');

    expect(result).toBe('loaded');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: directoryQueryOptions(QUERY, null).queryKey,
      }),
    );
  });
});
