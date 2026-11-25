import { describe, expect, test } from 'bun:test';

import type { MediaFileView } from '../../../../../lib/core/media/media-file.ts';
import type { UserSummaryRecord } from '../../../../../lib/core/profile/ports.ts';
import { imageFileViewOf } from '../../../../../test/support/media-file-view.ts';
import type { CommentPage } from '../../../../application/engagement/comment-reader.ts';
import type { ProductRatingView } from '../../../../application/engagement/product-rating-view.ts';
import type { CommentView } from '../../../../domain/engagement/comment-threads.ts';
import type { LoadedMedia } from '../media-lookup.ts';
import { publicApiOriginsOf } from './common-mappers.ts';
import {
  mediaRequestOfCommentPage,
  toCommentListPage,
  toRatingSummary,
} from './engagement-mappers.ts';

const IMAGES_ORIGIN = 'https://images.launch.example';

const SITE_ORIGIN = 'https://launch.example';

const ORIGINS = publicApiOriginsOf({
  IMAGES_ORIGIN,
  CLIENT_SITE_ORIGIN: SITE_ORIGIN,
});

const AUTHOR_ID = '01JC0VSER00000000000000001';

const REPLIER_ID = '01JC0VSER00000000000000002';

const HIDDEN_AUTHOR_ID = '01JC0VSER00000000000000003';

const AVATAR_FILE_ID = '01JC0F00000000000000000001';

const AVATAR_KEY = '0123456789abcdef'.repeat(2);

const commentIdOf = (index: number): string =>
  `01JD0CMNT${String(index).padStart(17, '0')}`;

const servableAvatar: MediaFileView = imageFileViewOf({
  id: AVATAR_FILE_ID,
  objectKey: AVATAR_KEY,
  location: 'images',
  moderationStatus: 'passed',
  quarantineReasons: Object.freeze([]),
  quarantined: false,
});

const userOf = (
  userId: string,
  handle: string,
  avatarFileId: string | null,
): UserSummaryRecord => ({
  userId,
  handle,
  nickname: `${handle}さん`,
  avatarFileId,
  suspended: false,
});

const LOADED: LoadedMedia = {
  files: new Map([[AVATAR_FILE_ID, servableAvatar]]),
  users: new Map([
    [AUTHOR_ID, userOf(AUTHOR_ID, 'alice', AVATAR_FILE_ID)],
    [REPLIER_ID, userOf(REPLIER_ID, 'bob', null)],
  ]),
};

const shownOf = (
  index: number,
  authorUserId: string,
  overrides: Partial<Extract<CommentView, { kind: 'shown' }>> = {},
): CommentView => ({
  kind: 'shown',
  id: commentIdOf(index),
  parentId: null,
  depth: 1,
  authorUserId,
  bodyMarkdown: `本文${String(index)}`,
  createdAt: new Date(Date.UTC(2026, 10, 5, 3, index)),
  edited: false,
  byProductOwner: false,
  viewerIsAuthor: false,
  ...overrides,
});

const removedOf = (
  index: number,
  depth: 1 | 2 | 3 = 1,
  parentId: string | null = null,
): CommentView => ({
  kind: 'removed',
  id: commentIdOf(index),
  parentId,
  depth,
});

const pageOf = (overrides: Partial<CommentPage> = {}): CommentPage => ({
  threads: [],
  endCursor: null,
  hasNextPage: false,
  ...overrides,
});

describe('コメントの写像', () => {
  test('一括の照会へ表示できるコメントの投稿者だけを求め、画像は利用者から辿る', () => {
    const page = pageOf({
      threads: [
        {
          comment: shownOf(1, AUTHOR_ID),
          replies: [
            shownOf(2, REPLIER_ID, { depth: 2, parentId: commentIdOf(1) }),
            removedOf(3, 3, commentIdOf(2)),
          ],
        },
        { comment: removedOf(4), replies: [] },
      ],
    });

    expect(mediaRequestOfCommentPage(page)).toEqual({
      fileIds: [],
      userIds: [AUTHOR_ID, REPLIER_ID],
    });
  });

  test('表示できるコメントを親のID・投稿者の表示情報・本文・日時・編集済みの印で返し、返信を上流の古い順のまま添える', () => {
    const page = toCommentListPage(
      pageOf({
        threads: [
          {
            comment: shownOf(1, AUTHOR_ID, { edited: true }),
            replies: [
              shownOf(3, REPLIER_ID, { depth: 2, parentId: commentIdOf(1) }),
              shownOf(2, AUTHOR_ID, {
                depth: 3,
                parentId: commentIdOf(3),
                byProductOwner: true,
                viewerIsAuthor: true,
              }),
            ],
          },
        ],
        endCursor: 'opaque-cursor',
        hasNextPage: true,
      }),
      LOADED,
      ORIGINS,
    );

    expect(page).toEqual({
      data: [
        {
          id: commentIdOf(1),
          parent_id: null,
          depth: 1,
          removed: false,
          author: {
            handle: 'alice',
            nickname: 'aliceさん',
            avatar: {
              url: `${IMAGES_ORIGIN}/${AVATAR_KEY}/square-lg.png`,
              width: 640,
              height: 480,
            },
            profile_url: `${SITE_ORIGIN}/@alice`,
          },
          body_markdown: '本文1',
          created_at: '2026-11-05T03:01:00.000Z',
          edited: true,
          replies: [
            {
              id: commentIdOf(3),
              parent_id: commentIdOf(1),
              depth: 2,
              removed: false,
              author: {
                handle: 'bob',
                nickname: 'bobさん',
                avatar: null,
                profile_url: `${SITE_ORIGIN}/@bob`,
              },
              body_markdown: '本文3',
              created_at: '2026-11-05T03:03:00.000Z',
              edited: false,
            },
            {
              id: commentIdOf(2),
              parent_id: commentIdOf(3),
              depth: 3,
              removed: false,
              author: {
                handle: 'alice',
                nickname: 'aliceさん',
                avatar: {
                  url: `${IMAGES_ORIGIN}/${AVATAR_KEY}/square-lg.png`,
                  width: 640,
                  height: 480,
                },
                profile_url: `${SITE_ORIGIN}/@alice`,
              },
              body_markdown: '本文2',
              created_at: '2026-11-05T03:02:00.000Z',
              edited: false,
            },
          ],
        },
      ],
      meta: { has_next: true, next_cursor: 'opaque-cursor' },
    });
  });

  test('置き換え表示のコメントは本文と投稿者を含めず、投稿者・本文・日時をnull、編集済みを偽、削除の印を真で返し、親のIDは返す', () => {
    const page = toCommentListPage(
      pageOf({
        threads: [
          {
            comment: removedOf(1),
            replies: [removedOf(2, 2, commentIdOf(1))],
          },
        ],
      }),
      LOADED,
      ORIGINS,
    );

    expect(page.data).toEqual([
      {
        id: commentIdOf(1),
        parent_id: null,
        depth: 1,
        removed: true,
        author: null,
        body_markdown: null,
        created_at: null,
        edited: false,
        replies: [
          {
            id: commentIdOf(2),
            parent_id: commentIdOf(1),
            depth: 2,
            removed: true,
            author: null,
            body_markdown: null,
            created_at: null,
            edited: false,
          },
        ],
      },
    ]);
    expect(page.meta).toEqual({ has_next: false, next_cursor: null });
  });

  test('照会の後に表示できなくなった投稿者は、表示できるコメントの投稿者だけをnullにする', () => {
    const page = toCommentListPage(
      pageOf({
        threads: [{ comment: shownOf(1, HIDDEN_AUTHOR_ID), replies: [] }],
      }),
      LOADED,
      ORIGINS,
    );

    expect(page.data[0]).toMatchObject({
      removed: false,
      author: null,
      body_markdown: '本文1',
    });
  });
});

describe('評価の集計の写像', () => {
  const viewOf = (
    overrides: Partial<ProductRatingView>,
  ): ProductRatingView => ({
    productId: '01JD0PR0D00000000000000001',
    average: null,
    count: 0,
    viewerScore: null,
    ...overrides,
  });

  test('丸めない平均値と件数を返し、閲覧者の評価を含めない', () => {
    expect(
      toRatingSummary(viewOf({ average: 11 / 3, count: 3, viewerScore: 5 })),
    ).toEqual({ average: 11 / 3, count: 3 });
  });

  test('有効な評価が無ければ平均値をnull、件数を0で返す', () => {
    expect(toRatingSummary(viewOf({}))).toEqual({ average: null, count: 0 });
  });
});
