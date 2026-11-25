import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import type { MediaFileView } from '../../../../../lib/core/media/media-file.ts';
import { decodeCursor } from '../../../../../lib/core/pagination/opaque-cursor.ts';
import type { UserSummaryRecord } from '../../../../../lib/core/profile/ports.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
import { imageFileViewOf } from '../../../../../test/support/media-file-view.ts';
import type {
  UpvoteHistoryEntry,
  UpvoteHistoryPage,
} from '../../../../application/match/upvote-history-reader.ts';
import type { PublicSupporterPage } from '../../../../application/public-api/public-supporter-reader.ts';
import type { LoadedMedia } from '../media-lookup.ts';
import { publicApiOriginsOf } from './common-mappers.ts';
import {
  mediaRequestOfSupporters,
  mediaRequestOfUpvoteHistory,
  toSupporterListPage,
  toUpvoteHistoryListPage,
} from './upvote-mappers.ts';

const IMAGES_ORIGIN = 'https://images.launch.example';

const SITE_ORIGIN = 'https://launch.example';

const ORIGINS = publicApiOriginsOf({
  IMAGES_ORIGIN,
  CLIENT_SITE_ORIGIN: SITE_ORIGIN,
});

const VISIBLE_USER_ID = '01JC0VSER00000000000000001';

const HIDDEN_USER_ID = '01JC0VSER00000000000000002';

const AVATAR_FILE_ID = '01JC0F00000000000000000001';

const LOGO_FILE_ID = '01JC0F00000000000000000002';

const QUARANTINED_FILE_ID = '01JC0F00000000000000000003';

const AVATAR_KEY = '0123456789abcdef'.repeat(2);

const LOGO_KEY = 'fedcba9876543210'.repeat(2);

const UPVOTE_ID = '01JD0VPVT00000000000000001';

const servableImageOf = (id: string, objectKey: string): MediaFileView =>
  imageFileViewOf({
    id,
    objectKey,
    location: 'images',
    moderationStatus: 'passed',
    quarantineReasons: Object.freeze([]),
    quarantined: false,
  });

const visibleUser: UserSummaryRecord = {
  userId: VISIBLE_USER_ID,
  handle: 'alice',
  nickname: 'アリス',
  avatarFileId: AVATAR_FILE_ID,
  suspended: false,
};

const LOADED: LoadedMedia = {
  files: new Map([
    [AVATAR_FILE_ID, servableImageOf(AVATAR_FILE_ID, AVATAR_KEY)],
    [LOGO_FILE_ID, servableImageOf(LOGO_FILE_ID, LOGO_KEY)],
    [
      QUARANTINED_FILE_ID,
      imageFileViewOf({ id: QUARANTINED_FILE_ID, objectKey: LOGO_KEY }),
    ],
  ]),
  users: new Map([[VISIBLE_USER_ID, visibleUser]]),
};

const SUPPORTER_PAGE: PublicSupporterPage = {
  kind: 'page',
  supporters: [
    {
      userId: HIDDEN_USER_ID,
      upvotedAt: new Date('2026-11-05T02:59:00.000Z'),
    },
    {
      userId: VISIBLE_USER_ID,
      upvotedAt: new Date('2026-11-05T03:00:00.000Z'),
    },
  ],
  hasNextPage: true,
  endCursor: { upvotedAt: Date.UTC(2026, 10, 5, 3), upvoteId: UPVOTE_ID },
};

const PositionSchema = z.object({
  upvotedAt: z.number(),
  upvoteId: z.string(),
});

describe('サポーターの写像', () => {
  test('一括の照会へサポーターの利用者を求め、画像は利用者から辿る', () => {
    expect(mediaRequestOfSupporters(SUPPORTER_PAGE)).toEqual({
      fileIds: [],
      userIds: [HIDDEN_USER_ID, VISIBLE_USER_ID],
    });
  });

  test('可視の利用者だけを表示情報とUpvoteの日時で返し、続きの位置を不透明なカーソルにする', () => {
    const page = toSupporterListPage(SUPPORTER_PAGE, LOADED, ORIGINS);

    expect(page.data).toEqual([
      {
        user: {
          handle: 'alice',
          nickname: 'アリス',
          avatar: {
            url: `${IMAGES_ORIGIN}/${AVATAR_KEY}/square-lg.png`,
            width: 640,
            height: 480,
          },
          profile_url: `${SITE_ORIGIN}/@alice`,
        },
        upvoted_at: '2026-11-05T03:00:00.000Z',
      },
    ]);
    expect(page.meta.has_next).toBe(true);
    expect(
      decodeCursor(PositionSchema, page.meta.next_cursor ?? 'missing'),
    ).toEqual({ upvotedAt: Date.UTC(2026, 10, 5, 3), upvoteId: UPVOTE_ID });
  });

  test('続きの位置が無ければnext_cursorをnullにする', () => {
    const page = toSupporterListPage(
      { kind: 'page', supporters: [], hasNextPage: false, endCursor: null },
      LOADED,
      ORIGINS,
    );

    expect(page).toEqual({
      data: [],
      meta: { has_next: false, next_cursor: null },
    });
  });
});

const entryOf = (
  overrides: Partial<UpvoteHistoryEntry> = {},
  product: Partial<UpvoteHistoryEntry['product']> = {},
): UpvoteHistoryEntry => ({
  upvoteId: UPVOTE_ID,
  matchId: '01JD0MTCH00000000000000001',
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: parseBusinessDate('2026-11-05'),
  live: false,
  product: {
    productId: '01JD0PR0D00000000000000001',
    handle: 'rocketship',
    name: 'Rocketship',
    tagline: '宇宙へ。',
    categoryId: '01JD0CATG00000000000000001',
    websiteUrl: 'https://rocketship.example/',
    logoFileId: LOGO_FILE_ID,
    listed: true,
    ...product,
  },
  ownerUserId: VISIBLE_USER_ID,
  ...overrides,
});

const historyOf = (
  entries: readonly UpvoteHistoryEntry[],
  overrides: Partial<UpvoteHistoryPage> = {},
): UpvoteHistoryPage => ({
  totalCount: 5,
  dateTotals: [],
  entries,
  hasNextPage: false,
  endCursor: null,
  ...overrides,
});

describe('Upvote履歴の写像', () => {
  test('一括の照会へプロダクトのロゴを求め、利用者は求めない', () => {
    expect(
      mediaRequestOfUpvoteHistory(
        historyOf([
          entryOf(),
          entryOf({}, { logoFileId: QUARANTINED_FILE_ID }),
        ]),
      ),
    ).toEqual({ fileIds: [LOGO_FILE_ID, QUARANTINED_FILE_ID], userIds: [] });
  });

  test('マッチの種別・ラウンド・段階・実施日・開催中かどうかと、掲載中のプロダクトを返す', () => {
    const page = toUpvoteHistoryListPage(
      historyOf(
        [
          entryOf({
            kind: 'week',
            round: 2,
            stage: 'semifinal',
            live: true,
          }),
        ],
        { hasNextPage: true, endCursor: 'opaque-cursor' },
      ),
      LOADED,
      ORIGINS,
    );

    expect(page).toEqual({
      data: [
        {
          match_id: '01JD0MTCH00000000000000001',
          kind: 'week',
          round: 2,
          stage: 'semifinal',
          match_date: '2026-11-05',
          live: true,
          product: {
            handle: 'rocketship',
            name: 'Rocketship',
            logo: {
              url: `${IMAGES_ORIGIN}/${LOGO_KEY}/square-lg.png`,
              width: 640,
              height: 480,
            },
            listed: true,
          },
        },
      ],
      meta: { total: 5, has_next: true, next_cursor: 'opaque-cursor' },
    });
  });

  test('未掲載のプロダクトもハンドルを含めてlistedを偽で返し、配信できないロゴはnullにする', () => {
    const page = toUpvoteHistoryListPage(
      historyOf([
        entryOf(
          {},
          {
            handle: 'unlisted-one',
            name: '未掲載',
            listed: false,
            logoFileId: QUARANTINED_FILE_ID,
          },
        ),
      ]),
      LOADED,
      ORIGINS,
    );

    expect(page.data[0]?.product).toEqual({
      handle: 'unlisted-one',
      name: '未掲載',
      logo: null,
      listed: false,
    });
    expect(page.meta).toEqual({ total: 5, has_next: false, next_cursor: null });
  });
});
