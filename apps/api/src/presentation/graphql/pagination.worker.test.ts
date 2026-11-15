import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  CURSOR_PAGE_ARGS,
  decodeCursor,
  encodeCursor,
  OFFSET_PAGE_ARGS,
  toConnection,
  toOffsetPage,
} from './pagination.ts';

interface Row {
  readonly id: string;
  readonly createdAt: number;
}

const positionSchema = z.object({ createdAt: z.number(), id: z.string() });

const ROWS: readonly Row[] = [
  { id: 'a', createdAt: 3 },
  { id: 'b', createdAt: 2 },
  { id: 'c', createdAt: 1 },
];

const VALID_POSITION_JSON = '{"createdAt":1,"id":"???"}';

const textEncoder = new TextEncoder();

function cursorOf(row: Row): string {
  return encodeCursor({ createdAt: row.createdAt, id: row.id });
}

function toBase64Url(text: string): string {
  return textEncoder
    .encode(text)
    .toBase64({ alphabet: 'base64url', omitPadding: true });
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('例外が投げられませんでした');
}

describe('encodeCursor・decodeCursor', () => {
  test('位置をJSONにしてパディング無しのbase64urlで符号化する', () => {
    const position = { createdAt: 1_793_000_000_000, id: '投稿-01?>' };

    const cursor = encodeCursor(position);

    expect(cursor).toBe(toBase64Url(JSON.stringify(position)));
    expect(cursor).toMatch(/^[\w-]+$/u);
  });

  test('符号化したカーソルを検証規則に従って元の位置へ戻す', () => {
    const position = { createdAt: 1_793_000_000_000, id: '投稿-01?>' };

    expect(decodeCursor(positionSchema, encodeCursor(position))).toEqual(
      position,
    );
  });

  test.each([
    ['空文字列', ''],
    ['base64urlでない文字列', '***'],
    ['パディング付きの文字列', `${toBase64Url(VALID_POSITION_JSON)}=`],
    [
      '標準のbase64の記号を含む文字列',
      toBase64Url(VALID_POSITION_JSON).replace('_', '/'),
    ],
    [
      'UTF-8として不正な内容',
      new Uint8Array([0xff, 0xfe]).toBase64({
        alphabet: 'base64url',
        omitPadding: true,
      }),
    ],
    ['JSONでない内容', toBase64Url('not json')],
    ['検証規則に合わない内容', toBase64Url('{"createdAt":"1","id":"a"}')],
    ['オブジェクトでない内容', toBase64Url('[1,"a"]')],
  ])('%sを不正なカーソルとして拒否する', (_label, cursor) => {
    const error = captureError(() => decodeCursor(positionSchema, cursor));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'invalid_cursor',
      message: 'ページの位置の指定が正しくありません。',
    });
  });
});

describe('toConnection', () => {
  test('first+1件を取得できたら次のページがあり、first件と末尾のカーソルを返す', () => {
    const connection = toConnection(ROWS, 2, cursorOf);

    expect(connection).toEqual({
      nodes: [ROWS[0], ROWS[1]],
      pageInfo: {
        hasNextPage: true,
        endCursor: encodeCursor({ createdAt: 2, id: 'b' }),
      },
    });
  });

  test('first件以下なら次のページは無く、末尾の要素のカーソルを返す', () => {
    const connection = toConnection(ROWS, 3, cursorOf);

    expect(connection.nodes).toEqual(ROWS);
    expect(connection.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: encodeCursor({ createdAt: 1, id: 'c' }),
    });
  });

  test('0件なら次のページは無く、末尾のカーソルはnullになる', () => {
    expect(toConnection([], 20, cursorOf)).toEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });
});

describe('toOffsetPage', () => {
  test.each([
    [25, 10, 3],
    [20, 10, 2],
    [1, 100, 1],
    [0, 10, 0],
  ])(
    '総件数%iと1ページ%i件から総ページ数%iを求める',
    (totalCount, perPage, totalPages) => {
      expect(toOffsetPage(ROWS, totalCount, 1, perPage).pageInfo).toEqual({
        page: 1,
        perPage,
        totalCount,
        totalPages,
      });
    },
  );

  test('取得した行をそのままページの要素にし、ページ番号を返す', () => {
    const page = toOffsetPage(ROWS, 23, 3, 10);

    expect(page.nodes).toEqual(ROWS);
    expect(page.pageInfo.page).toBe(3);
  });
});

describe('CURSOR_PAGE_ARGS', () => {
  test.each([1, 100])('firstが%iなら受け付ける', (first) => {
    expect(CURSOR_PAGE_ARGS.parse({ first })).toEqual({ first });
  });

  test('afterの文字列を受け付ける', () => {
    expect(CURSOR_PAGE_ARGS.parse({ first: 20, after: 'abc' })).toEqual({
      first: 20,
      after: 'abc',
    });
  });

  test('nullのafterは指定なしとして扱う', () => {
    const parsed = CURSOR_PAGE_ARGS.parse({ first: 20, after: null });

    expect(parsed.first).toBe(20);
    expect(parsed.after).toBeUndefined();
  });

  test.each([
    ['firstが0', { first: 0 }],
    ['firstが101', { first: 101 }],
    ['firstが小数', { first: 1.5 }],
    ['firstが未指定', {}],
    ['afterが文字列以外', { first: 1, after: 1 }],
  ])('%sの引数を拒否する', (_label, args) => {
    expect(CURSOR_PAGE_ARGS.safeParse(args).success).toBe(false);
  });
});

describe('OFFSET_PAGE_ARGS', () => {
  test.each([
    [1, 1],
    [1000, 100],
  ])('pageが%i・perPageが%iなら受け付ける', (page, perPage) => {
    expect(OFFSET_PAGE_ARGS.parse({ page, perPage })).toEqual({
      page,
      perPage,
    });
  });

  test.each([
    ['pageが0', { page: 0, perPage: 10 }],
    ['pageが小数', { page: 1.5, perPage: 10 }],
    ['perPageが0', { page: 1, perPage: 0 }],
    ['perPageが101', { page: 1, perPage: 101 }],
    ['perPageが小数', { page: 1, perPage: 2.5 }],
    ['pageが未指定', { perPage: 10 }],
  ])('%sの引数を拒否する', (_label, args) => {
    expect(OFFSET_PAGE_ARGS.safeParse(args).success).toBe(false);
  });
});
