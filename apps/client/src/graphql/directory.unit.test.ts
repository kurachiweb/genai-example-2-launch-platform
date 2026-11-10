import { describe, expect, test } from 'bun:test';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  directoryCategoriesQueryOptions,
  directoryInputOf,
  directoryQueryOptions,
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
