import { describe, expect, test } from 'bun:test';

import type {
  CommentDepth,
  CommentRow,
  CommentThreadRows,
} from '../../../lib/core/engagement/ports.ts';
import { toCommentViews } from './comment-threads.ts';

const OWNER_ID = 'owner-1';
const VIEWER_ID = 'viewer-1';
const OTHER_ID = 'other-1';

const shown = (input: {
  readonly commentId: string;
  readonly parentId: string | null;
  readonly depth: CommentDepth;
  readonly authorUserId: string;
  readonly edited?: boolean;
}): CommentRow => ({
  kind: 'shown',
  commentId: input.commentId,
  parentId: input.parentId,
  depth: input.depth,
  authorUserId: input.authorUserId,
  bodyMarkdown: `${input.commentId}の本文`,
  createdAt: new Date('2026-10-01T09:00:00.000Z'),
  edited: input.edited ?? false,
});

const removed = (input: {
  readonly commentId: string;
  readonly parentId: string | null;
  readonly depth: CommentDepth;
}): CommentRow => ({ kind: 'removed', ...input });

describe('toCommentViews の組み立て', () => {
  test('スレッドの照会の行をページの順のままトップレベルと返信のスレッドへ組み立てる', () => {
    const threads: readonly CommentThreadRows[] = [
      {
        root: shown({
          commentId: 'c-2',
          parentId: null,
          depth: 1,
          authorUserId: OTHER_ID,
          edited: true,
        }),
        replies: [
          shown({
            commentId: 'c-3',
            parentId: 'c-2',
            depth: 2,
            authorUserId: OTHER_ID,
          }),
          removed({ commentId: 'c-4', parentId: 'c-3', depth: 3 }),
        ],
      },
      {
        root: shown({
          commentId: 'c-1',
          parentId: null,
          depth: 1,
          authorUserId: OTHER_ID,
        }),
        replies: [],
      },
    ];

    expect(
      toCommentViews({
        threads,
        ownerUserId: OWNER_ID,
        viewerUserId: undefined,
      }),
    ).toEqual([
      {
        comment: {
          kind: 'shown',
          id: 'c-2',
          parentId: null,
          depth: 1,
          authorUserId: OTHER_ID,
          bodyMarkdown: 'c-2の本文',
          createdAt: new Date('2026-10-01T09:00:00.000Z'),
          edited: true,
          byProductOwner: false,
          viewerIsAuthor: false,
        },
        replies: [
          {
            kind: 'shown',
            id: 'c-3',
            parentId: 'c-2',
            depth: 2,
            authorUserId: OTHER_ID,
            bodyMarkdown: 'c-3の本文',
            createdAt: new Date('2026-10-01T09:00:00.000Z'),
            edited: false,
            byProductOwner: false,
            viewerIsAuthor: false,
          },
          { kind: 'removed', id: 'c-4', parentId: 'c-3', depth: 3 },
        ],
      },
      {
        comment: {
          kind: 'shown',
          id: 'c-1',
          parentId: null,
          depth: 1,
          authorUserId: OTHER_ID,
          bodyMarkdown: 'c-1の本文',
          createdAt: new Date('2026-10-01T09:00:00.000Z'),
          edited: false,
          byProductOwner: false,
          viewerIsAuthor: false,
        },
        replies: [],
      },
    ]);
  });

  test('コメントが無ければ空の一覧を返す', () => {
    expect(
      toCommentViews({
        threads: [],
        ownerUserId: OWNER_ID,
        viewerUserId: VIEWER_ID,
      }),
    ).toEqual([]);
  });
});

describe('toCommentViews の投稿者本人と閲覧者自身の判定', () => {
  const threads: readonly CommentThreadRows[] = [
    {
      root: shown({
        commentId: 'c-1',
        parentId: null,
        depth: 1,
        authorUserId: OWNER_ID,
      }),
      replies: [
        shown({
          commentId: 'c-2',
          parentId: 'c-1',
          depth: 2,
          authorUserId: VIEWER_ID,
        }),
        shown({
          commentId: 'c-3',
          parentId: 'c-2',
          depth: 3,
          authorUserId: OTHER_ID,
        }),
      ],
    },
  ];

  const flagsOf = (viewerUserId: string | undefined) =>
    toCommentViews({ threads, ownerUserId: OWNER_ID, viewerUserId }).flatMap(
      ({ comment, replies }) =>
        [comment, ...replies].map((view) =>
          view.kind === 'shown'
            ? [view.id, view.byProductOwner, view.viewerIsAuthor]
            : [view.id],
        ),
    );

  test('プロダクトの投稿者本人のコメントにだけバッジの判定を真にする', () => {
    expect(flagsOf(VIEWER_ID)).toEqual([
      ['c-1', true, false],
      ['c-2', false, true],
      ['c-3', false, false],
    ]);
  });

  test('投稿者本人が閲覧するとバッジと作者の判定が両方とも真になる', () => {
    expect(flagsOf(OWNER_ID)).toEqual([
      ['c-1', true, true],
      ['c-2', false, false],
      ['c-3', false, false],
    ]);
  });

  test('ログインしていない閲覧者には作者の判定を常に偽にする', () => {
    expect(flagsOf(undefined)).toEqual([
      ['c-1', true, false],
      ['c-2', false, false],
      ['c-3', false, false],
    ]);
  });
});

describe('toCommentViews の置き換え表示', () => {
  test.each([OWNER_ID, VIEWER_ID, undefined])(
    '置き換え表示はバッジと作者の判定を持たず、閲覧者(%s)によらず事情を区別しない',
    (viewerUserId) => {
      const views = toCommentViews({
        threads: [
          {
            root: removed({ commentId: 'c-1', parentId: null, depth: 1 }),
            replies: [
              removed({ commentId: 'c-2', parentId: 'c-1', depth: 2 }),
              removed({ commentId: 'c-3', parentId: 'c-2', depth: 3 }),
            ],
          },
        ],
        ownerUserId: OWNER_ID,
        viewerUserId,
      });

      expect(views).toEqual([
        {
          comment: { kind: 'removed', id: 'c-1', parentId: null, depth: 1 },
          replies: [
            { kind: 'removed', id: 'c-2', parentId: 'c-1', depth: 2 },
            { kind: 'removed', id: 'c-3', parentId: 'c-2', depth: 3 },
          ],
        },
      ]);
      for (const view of [views[0]?.comment, ...(views[0]?.replies ?? [])]) {
        expect(view).not.toHaveProperty('byProductOwner');
        expect(view).not.toHaveProperty('viewerIsAuthor');
        expect(view).not.toHaveProperty('authorUserId');
      }
    },
  );
});
