import { describe, expect, test } from 'bun:test';

import type { LaunchCommentFragment } from '../../graphql/generated/graphql.ts';
import {
  appendReply,
  buildTree,
  type LaunchCommentsData,
  type LaunchCommentThread,
  prependThread,
  replaceComment,
} from './comment-tree.ts';

const commentOf = (
  id: string,
  overrides: Partial<LaunchCommentFragment> = {},
): LaunchCommentFragment => ({
  id,
  parentId: null,
  depth: 1,
  state: 'SHOWN',
  author: {
    handle: 'pitch_maker',
    nickname: 'ピッチの作り手',
    avatar: null,
  },
  body: `${id}の本文`,
  createdAt: '2026-11-10T03:00:00.000Z',
  edited: false,
  byProductOwner: false,
  viewerIsAuthor: false,
  ...overrides,
});

const replyOf = (
  id: string,
  parentId: string,
  depth: 2 | 3,
): LaunchCommentFragment => commentOf(id, { parentId, depth });

const ROOT_A = 'A0000000000000000000000000';
const ROOT_B = 'B0000000000000000000000000';
const ROOT_C = 'C0000000000000000000000000';
const REPLY_A1 = 'A1000000000000000000000000';
const REPLY_A2 = 'A2000000000000000000000000';
const REPLY_A11 = 'A1100000000000000000000000';
const REPLY_A12 = 'A1200000000000000000000000';
const REPLY_C1 = 'C1000000000000000000000000';

const threadA = (): LaunchCommentThread => ({
  comment: commentOf(ROOT_A),
  replies: [
    replyOf(REPLY_A1, ROOT_A, 2),
    replyOf(REPLY_A11, REPLY_A1, 3),
    replyOf(REPLY_A2, ROOT_A, 2),
    replyOf(REPLY_A12, REPLY_A1, 3),
  ],
});

const dataOf = (): LaunchCommentsData => ({
  pages: [
    {
      launchComments: {
        nodes: [threadA(), { comment: commentOf(ROOT_B), replies: [] }],
        pageInfo: { endCursor: 'cursor-b', hasNextPage: true },
      },
    },
    {
      launchComments: {
        nodes: [
          {
            comment: commentOf(ROOT_C),
            replies: [replyOf(REPLY_C1, ROOT_C, 2)],
          },
        ],
        pageInfo: { endCursor: 'cursor-c', hasNextPage: false },
      },
    },
  ],
  pageParams: [null, 'cursor-b'],
});

// 元のデータを変えないことを、全体を深く凍結して書き換えの例外で確かめる
const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
};

const frozenData = (): LaunchCommentsData => deepFreeze(dataOf());

const threadsOf = (data: LaunchCommentsData | undefined) =>
  data?.pages.map((page) => page.launchComments?.nodes ?? []) ?? [];

const idsOf = (data: LaunchCommentsData | undefined) =>
  threadsOf(data).map((nodes) =>
    nodes.map(({ comment, replies }) => [
      comment.id,
      replies.map(({ id }) => id),
    ]),
  );

describe('buildTree', () => {
  test('平たい返信の一覧を親ごとの木にし、同じ親の返信を一覧の順(古い順)に並べる', () => {
    const tree = buildTree(threadA());

    expect(tree.comment.id).toBe(ROOT_A);
    expect(
      tree.replies.map(({ comment, replies }) => [
        comment.id,
        replies.map((child) => child.comment.id),
      ]),
    ).toEqual([
      [REPLY_A1, [REPLY_A11, REPLY_A12]],
      [REPLY_A2, []],
    ]);
    expect(tree.replies[0]?.replies[0]?.replies).toEqual([]);
  });

  test('返信の無いトップレベルは空の返信の木になる', () => {
    expect(buildTree({ comment: commentOf(ROOT_B), replies: [] })).toEqual({
      comment: commentOf(ROOT_B),
      replies: [],
    });
  });

  test('置き換え表示の返信も親として子の返信を残す', () => {
    const removed = commentOf(REPLY_A1, {
      parentId: ROOT_A,
      depth: 2,
      state: 'REMOVED',
      author: null,
      body: null,
      createdAt: null,
    });
    const tree = buildTree({
      comment: commentOf(ROOT_A),
      replies: [removed, replyOf(REPLY_A11, REPLY_A1, 3)],
    });

    expect(tree.replies[0]?.comment).toBe(removed);
    expect(tree.replies[0]?.replies.map(({ comment }) => comment.id)).toEqual([
      REPLY_A11,
    ]);
  });

  test('親が一覧に無い返信は木に含めない', () => {
    const tree = buildTree({
      comment: commentOf(ROOT_A),
      replies: [replyOf(REPLY_A11, REPLY_A1, 3)],
    });

    expect(tree.replies).toEqual([]);
  });

  test('元のスレッドを変えない', () => {
    const thread = deepFreeze(threadA());

    expect(() => buildTree(thread)).not.toThrow();
    expect(thread).toEqual(threadA());
  });
});

describe('prependThread(トップレベルの投稿)', () => {
  test('最初のページの先頭へ返信の無いスレッドとして加え、ページの区切りとカーソルを保つ', () => {
    const posted = commentOf('D0000000000000000000000000');
    const data = frozenData();

    const updated = prependThread(data, posted);

    expect(idsOf(updated)).toEqual([
      [
        ['D0000000000000000000000000', []],
        [ROOT_A, [REPLY_A1, REPLY_A11, REPLY_A2, REPLY_A12]],
        [ROOT_B, []],
      ],
      [[ROOT_C, [REPLY_C1]]],
    ]);
    expect(updated?.pages[0]?.launchComments?.nodes[0]).toEqual({
      comment: posted,
      replies: [],
    });
    expect(updated?.pages[0]?.launchComments?.pageInfo).toEqual(
      data.pages[0]?.launchComments?.pageInfo,
    );
    expect(updated?.pageParams).toEqual([null, 'cursor-b']);
    expect(updated?.pages[1]).toBe(data.pages[1]);
    expect(data).toEqual(dataOf());
  });

  test('既に一覧にあるコメントは重ねて加えない', () => {
    const data = frozenData();

    expect(prependThread(data, commentOf(ROOT_C))).toBe(data);
  });

  test('キャッシュが無ければ何もしない', () => {
    expect(prependThread(undefined, commentOf(ROOT_A))).toBeUndefined();
  });

  test('最初のページのスレッドがnull(閲覧できないローンチ)なら変えない', () => {
    const data = deepFreeze<LaunchCommentsData>({
      pages: [{ launchComments: null }],
      pageParams: [null],
    });

    expect(prependThread(data, commentOf(ROOT_A))).toBe(data);
  });
});

describe('appendReply(返信)', () => {
  test('トップレベルへの返信をそのスレッドの返信の末尾へ加える', () => {
    const reply = replyOf('A3000000000000000000000000', ROOT_A, 2);
    const data = frozenData();

    const updated = appendReply(data, reply);

    expect(idsOf(updated)[0]?.[0]).toEqual([
      ROOT_A,
      [REPLY_A1, REPLY_A11, REPLY_A2, REPLY_A12, 'A3000000000000000000000000'],
    ]);
    expect(updated?.pages[0]?.launchComments?.nodes[1]).toBe(
      data.pages[0]?.launchComments?.nodes[1],
    );
    expect(updated?.pages[1]).toBe(data.pages[1]);
    expect(data).toEqual(dataOf());
  });

  test('第2階層への返信を親のスレッドの末尾へ加え、木では親の子の最後になる', () => {
    const reply = replyOf('A1300000000000000000000000', REPLY_A1, 3);

    const updated = appendReply(frozenData(), reply);
    const thread = updated?.pages[0]?.launchComments?.nodes[0];

    expect(thread?.replies.at(-1)).toEqual(reply);
    expect(
      buildTree(thread ?? threadA()).replies[0]?.replies.map(
        ({ comment }) => comment.id,
      ),
    ).toEqual([REPLY_A11, REPLY_A12, 'A1300000000000000000000000']);
  });

  test('続きのページのスレッドへの返信もそのスレッドへ加える', () => {
    const reply = replyOf('C2000000000000000000000000', REPLY_C1, 3);
    const data = frozenData();

    const updated = appendReply(data, reply);

    expect(idsOf(updated)[1]).toEqual([
      [ROOT_C, [REPLY_C1, 'C2000000000000000000000000']],
    ]);
    expect(updated?.pages[0]).toBe(data.pages[0]);
  });

  test('スレッドがnullのページはそのまま残す', () => {
    const base = dataOf();
    const data = deepFreeze<LaunchCommentsData>({
      ...base,
      pages: [...base.pages, { launchComments: null }],
      pageParams: [...base.pageParams, 'cursor-c'],
    });
    const reply = replyOf('A3000000000000000000000000', ROOT_A, 2);

    const updated = appendReply(data, reply);

    expect(updated?.pages[0]?.launchComments?.nodes[0]?.replies.at(-1)).toBe(
      reply,
    );
    expect(updated?.pages[2]).toBe(data.pages[2]);
  });

  test('親が読み込んだスレッドに無ければ変えない', () => {
    const data = frozenData();

    expect(
      appendReply(data, replyOf('E1000000000000000000000000', 'E0', 2)),
    ).toBe(data);
  });

  test('既に一覧にある返信は重ねて加えない', () => {
    const data = frozenData();

    expect(appendReply(data, replyOf(REPLY_A2, ROOT_A, 2))).toBe(data);
  });

  test('親の無いコメントやキャッシュの無い場合は変えない', () => {
    const data = frozenData();

    expect(appendReply(data, commentOf('D0000000000000000000000000'))).toBe(
      data,
    );
    expect(
      appendReply(undefined, replyOf(REPLY_A2, ROOT_A, 2)),
    ).toBeUndefined();
  });
});

describe('replaceComment(編集・削除)', () => {
  test('トップレベルのコメントを返り値で置き換え、返信と他のページを保つ', () => {
    const edited = commentOf(ROOT_A, { body: '直した本文', edited: true });
    const data = frozenData();

    const updated = replaceComment(data, edited);
    const thread = updated?.pages[0]?.launchComments?.nodes[0];

    expect(thread?.comment).toEqual(edited);
    expect(thread?.replies).toBe(
      data.pages[0]?.launchComments?.nodes[0]?.replies,
    );
    expect(updated?.pages[1]).toBe(data.pages[1]);
    expect(data).toEqual(dataOf());
  });

  test('返信を同じ位置のまま返り値で置き換える', () => {
    const edited = commentOf(REPLY_A11, {
      parentId: REPLY_A1,
      depth: 3,
      body: '直した返信',
      edited: true,
    });

    const updated = replaceComment(frozenData(), edited);

    expect(updated?.pages[0]?.launchComments?.nodes[0]?.replies).toEqual([
      replyOf(REPLY_A1, ROOT_A, 2),
      edited,
      replyOf(REPLY_A2, ROOT_A, 2),
      replyOf(REPLY_A12, REPLY_A1, 3),
    ]);
  });

  test('削除の返り値の置き換え表示で置き換え、親子の関係と子の返信を残す', () => {
    const removed = commentOf(REPLY_A1, {
      parentId: ROOT_A,
      depth: 2,
      state: 'REMOVED',
      author: null,
      body: null,
      createdAt: null,
    });

    const updated = replaceComment(frozenData(), removed);
    const thread = updated?.pages[0]?.launchComments?.nodes[0];

    expect(thread?.replies[0]).toEqual(removed);
    expect(
      buildTree(thread ?? threadA()).replies[0]?.replies.map(
        ({ comment }) => comment.id,
      ),
    ).toEqual([REPLY_A11, REPLY_A12]);
  });

  test('一覧に無いコメントなら変えない', () => {
    const data = frozenData();

    expect(replaceComment(data, commentOf('E0000000000000000000000000'))).toBe(
      data,
    );
    expect(replaceComment(undefined, commentOf(ROOT_A))).toBeUndefined();
  });
});
