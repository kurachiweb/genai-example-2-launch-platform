import { describe, expect, test } from 'bun:test';

import type { MediaFileView } from '../../../../../lib/core/media/media-file.ts';
import type { AwardGroup } from '../../../../../lib/core/product/launch-summary.ts';
import type {
  ProductCategoryRecord,
  ProductSummaryRecord,
} from '../../../../../lib/core/product/ports.ts';
import type { UserSummaryRecord } from '../../../../../lib/core/profile/ports.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
import { imageFileViewOf } from '../../../../../test/support/media-file-view.ts';
import type {
  DirectoryItemView,
  DirectoryPageView,
} from '../../../../application/directory/directory-reader.ts';
import type {
  ProductPageLaunchView,
  ProductPageView,
} from '../../../../application/directory/product-page-reader.ts';
import type { BaseWinKind } from '../../../../domain/directory/base-win.ts';
import type {
  HistoryRow,
  OpponentView,
} from '../../../../domain/directory/match-history.ts';
import type { LoadedMedia } from '../media-lookup.ts';
import type { LaunchMatchOpponent } from '../schemas/products.ts';
import { publicApiOriginsOf } from './common-mappers.ts';
import {
  mediaRequestOfDirectoryPage,
  mediaRequestOfProductPage,
  toLaunches,
  toProductCategory,
  toProductDetail,
  toProductListPage,
} from './product-mappers.ts';

const IMAGES_ORIGIN = 'https://images.launch.example';

const SITE_ORIGIN = 'https://launch.example';

const ORIGINS = publicApiOriginsOf({
  IMAGES_ORIGIN,
  CLIENT_SITE_ORIGIN: SITE_ORIGIN,
});

const OWNER_ID = '01JC0VSER00000000000000001';

const HIDDEN_OWNER_ID = '01JC0VSER00000000000000002';

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const RIVAL_ID = '01JD0PR0D00000000000000002';

const LOGO_FILE_ID = '01JC0F00000000000000000001';

const SCREENSHOT_FILE_ID = '01JC0F00000000000000000002';

const QUARANTINED_FILE_ID = '01JC0F00000000000000000003';

const LOGO_KEY = '0123456789abcdef'.repeat(2);

const SCREENSHOT_KEY = 'fedcba9876543210'.repeat(2);

const servableImageOf = (
  id: string,
  objectKey: string,
  overrides: Partial<MediaFileView> = {},
): MediaFileView =>
  imageFileViewOf({
    id,
    objectKey,
    location: 'images',
    moderationStatus: 'passed',
    quarantineReasons: Object.freeze([]),
    quarantined: false,
    ...overrides,
  });

const owner: UserSummaryRecord = {
  userId: OWNER_ID,
  handle: 'alice',
  nickname: 'アリス',
  avatarFileId: null,
  suspended: false,
};

const LOADED: LoadedMedia = {
  files: new Map([
    [LOGO_FILE_ID, servableImageOf(LOGO_FILE_ID, LOGO_KEY)],
    [
      SCREENSHOT_FILE_ID,
      servableImageOf(SCREENSHOT_FILE_ID, SCREENSHOT_KEY, {
        width: 1280,
        height: 720,
      }),
    ],
    [
      QUARANTINED_FILE_ID,
      imageFileViewOf({ id: QUARANTINED_FILE_ID, objectKey: LOGO_KEY }),
    ],
  ]),
  users: new Map([[OWNER_ID, owner]]),
};

const productOf = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  handle: 'rocketship',
  name: 'Rocketship',
  tagline: '宇宙へ。',
  category: {
    id: '01JD0CATG00000000000000001',
    name: 'ツール',
    handle: 'tools',
  },
  websiteUrl: 'https://rocketship.example/',
  logoFileId: LOGO_FILE_ID,
  hidden: false,
  visible: true,
  listed: true,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  ...overrides,
});

const AWARDS: readonly AwardGroup[] = [
  { kind: 'year', count: 1, labels: ['2026年 Year優勝'] },
  { kind: 'week', count: 2, labels: ['第1週 Week優勝', '第3週 Week優勝'] },
];

const itemOf = (
  kind: BaseWinKind,
  overrides: Partial<ProductSummaryRecord> = {},
): DirectoryItemView => ({
  product: productOf(overrides),
  isViewerOwn: false,
  baseWin: {
    launchDate: parseBusinessDate('2026-11-05'),
    kind,
    upvoteCount: kind === 'bye' ? null : 12,
  },
  awards: AWARDS,
  metrics: [{ key: 'comments', value: 3 }],
});

const directoryPageOf = (
  items: readonly DirectoryItemView[],
  overrides: Partial<DirectoryPageView> = {},
): DirectoryPageView => ({
  applied: {},
  searchTerms: [],
  businessToday: parseBusinessDate('2026-11-10'),
  totalCount: 41,
  page: 2,
  pageCount: 3,
  items,
  ...overrides,
});

const rowOf = (overrides: Partial<HistoryRow> = {}): HistoryRow => ({
  matchId: '01JD0MTCH00000000000000001',
  entryId: '01JD0ENTR00000000000000001',
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: parseBusinessDate('2026-11-05'),
  result: 'won',
  decision: 'votes',
  endedEarly: false,
  ownUpvoteCount: 12,
  opponentUpvoteCount: 9,
  opponent: { kind: 'listed', productId: RIVAL_ID },
  ...overrides,
});

const launchOf = (
  rows: readonly HistoryRow[],
  overrides: Partial<ProductPageLaunchView> = {},
): ProductPageLaunchView => ({
  launchId: '01JD01NCH00000000000000001',
  productId: PRODUCT_ID,
  number: 1,
  launchDate: parseBusinessDate('2026-11-05'),
  status: 'finished',
  outcome: 'won',
  decidedAt: new Date('2026-11-06T08:00:00.000Z'),
  summary: { label: 'ディレクトリ掲載', inMatch: false },
  kickedOff: true,
  latestKickedOff: true,
  rows,
  ...overrides,
});

const productPageOf = (
  overrides: Partial<ProductPageView> = {},
): ProductPageView => ({
  product: productOf(),
  detail: {
    productId: PRODUCT_ID,
    descriptionMarkdown: '# Rocketship\n\n宇宙へ。',
    screenshotFileIds: [SCREENSHOT_FILE_ID, QUARANTINED_FILE_ID],
  },
  ownerView: false,
  unlisted: false,
  record: {
    firstLaunchDate: parseBusinessDate('2026-10-30'),
    launchCount: 3,
    wins: 2,
    losses: 1,
  },
  awards: AWARDS,
  launches: [],
  opponents: new Map([
    [
      RIVAL_ID,
      productOf({ productId: RIVAL_ID, handle: 'rival', name: 'Rival' }),
    ],
  ]),
  ...overrides,
});

const EXPECTED_LOGO = {
  url: `${IMAGES_ORIGIN}/${LOGO_KEY}/square-lg.png`,
  width: 640,
  height: 480,
};

const EXPECTED_OWNER = {
  handle: 'alice',
  nickname: 'アリス',
  avatar: null,
  profile_url: `${SITE_ORIGIN}/@alice`,
};

describe('プロダクトの一覧の写像', () => {
  test('項目の識別子・表示の項目・投稿者・ロゴ・基準勝利・受賞・ページのURLとページ番号の情報を写す', () => {
    const page = toProductListPage(
      directoryPageOf([itemOf('victory')]),
      LOADED,
      ORIGINS,
    );

    expect(page).toEqual({
      data: [
        {
          id: PRODUCT_ID,
          handle: 'rocketship',
          name: 'Rocketship',
          tagline: '宇宙へ。',
          category: { handle: 'tools', name: 'ツール' },
          website_url: 'https://rocketship.example/',
          logo: EXPECTED_LOGO,
          owner: EXPECTED_OWNER,
          base_win: {
            launch_date: '2026-11-05',
            kind: 'victory',
            upvote_count: 12,
          },
          awards: [
            { kind: 'year', count: 1 },
            { kind: 'week', count: 2 },
          ],
          page_url: `${SITE_ORIGIN}/p/rocketship`,
        },
      ],
      meta: { total: 41, page: 2, per_page: 20, total_pages: 3 },
    });
  });

  test.each([
    ['victory', 12],
    ['bye', null],
    ['early', 12],
  ] as const)(
    '基準勝利の種類%sはそのまま写し、Upvote数は%pにする',
    (kind, upvoteCount) => {
      const [item] = toProductListPage(
        directoryPageOf([itemOf(kind)]),
        LOADED,
        ORIGINS,
      ).data;

      expect(item?.base_win).toEqual({
        launch_date: '2026-11-05',
        kind,
        upvote_count: upvoteCount,
      });
    },
  );

  test('検証に通らない外部WebサイトURLは空文字列にする', () => {
    const [item] = toProductListPage(
      directoryPageOf([
        itemOf('victory', { websiteUrl: 'javascript:alert(1)' }),
      ]),
      LOADED,
      ORIGINS,
    ).data;

    expect(item?.website_url).toBe('');
  });

  test('照会の結果に無い投稿者はnull、配信できないロゴはnullにする', () => {
    const [item] = toProductListPage(
      directoryPageOf([
        itemOf('victory', {
          ownerUserId: HIDDEN_OWNER_ID,
          logoFileId: QUARANTINED_FILE_ID,
        }),
      ]),
      LOADED,
      ORIGINS,
    ).data;

    expect(item?.owner).toBeNull();
    expect(item?.logo).toBeNull();
  });

  test('範囲外のページは空の一覧と照会の時点の総件数を返す', () => {
    expect(
      toProductListPage(
        directoryPageOf([], { totalCount: 3, page: 9, pageCount: 1 }),
        LOADED,
        ORIGINS,
      ),
    ).toEqual({
      data: [],
      meta: { total: 3, page: 9, per_page: 20, total_pages: 1 },
    });
  });

  test('一括の照会には全ての項目のロゴと投稿者を1つの要求にまとめる', () => {
    const second = itemOf('bye', {
      productId: RIVAL_ID,
      ownerUserId: HIDDEN_OWNER_ID,
      logoFileId: SCREENSHOT_FILE_ID,
    });

    expect(
      mediaRequestOfDirectoryPage(directoryPageOf([itemOf('victory'), second])),
    ).toEqual({
      fileIds: [LOGO_FILE_ID, SCREENSHOT_FILE_ID],
      userIds: [OWNER_ID, HIDDEN_OWNER_ID],
    });
  });
});

describe('プロダクト詳細の写像', () => {
  test('一覧の項目に加えて説明文・スクリーンショット・初ローンチ日・ローンチ回数・通算成績を写し、基準勝利を含めない', () => {
    expect(toProductDetail(productPageOf(), LOADED, ORIGINS)).toEqual({
      id: PRODUCT_ID,
      handle: 'rocketship',
      name: 'Rocketship',
      tagline: '宇宙へ。',
      category: { handle: 'tools', name: 'ツール' },
      website_url: 'https://rocketship.example/',
      logo: EXPECTED_LOGO,
      owner: EXPECTED_OWNER,
      awards: [
        { kind: 'year', count: 1 },
        { kind: 'week', count: 2 },
      ],
      page_url: `${SITE_ORIGIN}/p/rocketship`,
      description_markdown: '# Rocketship\n\n宇宙へ。',
      screenshots: [
        {
          url: `${IMAGES_ORIGIN}/${SCREENSHOT_KEY}/screenshot-full.png`,
          width: 1280,
          height: 720,
        },
        null,
      ],
      first_launch_date: '2026-10-30',
      launch_count: 3,
      record: { wins: 2, losses: 1 },
    });
  });

  test('初ローンチ日が無いプロダクトはnullにし、検証に通らない外部WebサイトURLは空文字列にする', () => {
    const detail = toProductDetail(
      productPageOf({
        product: productOf({ websiteUrl: 'ftp://rocketship.example/' }),
        record: { firstLaunchDate: null, launchCount: 0, wins: 0, losses: 0 },
      }),
      LOADED,
      ORIGINS,
    );

    expect(detail.first_launch_date).toBeNull();
    expect(detail.website_url).toBe('');
    expect(detail.record).toEqual({ wins: 0, losses: 0 });
  });

  test('一括の照会にはロゴ・スクリーンショットと投稿者を1つの要求にまとめる', () => {
    expect(mediaRequestOfProductPage(productPageOf())).toEqual({
      fileIds: [LOGO_FILE_ID, SCREENSHOT_FILE_ID, QUARANTINED_FILE_ID],
      userIds: [OWNER_ID],
    });
  });
});

describe('ローンチ履歴の写像', () => {
  test('ローンチの識別子・第◯回・ローンチ日・状態・結果の要約と、確定したマッチの各項目を写す', () => {
    const launches = toLaunches(
      productPageOf({ launches: [launchOf([rowOf()])] }),
    );

    expect(launches).toEqual([
      {
        id: '01JD01NCH00000000000000001',
        number: 1,
        launch_date: '2026-11-05',
        status: 'finished',
        summary: 'ディレクトリ掲載',
        matches: [
          {
            id: '01JD0MTCH00000000000000001',
            kind: 'qualifier',
            round: null,
            stage: null,
            match_date: '2026-11-05',
            result: 'won',
            decision: 'votes',
            ended_early: false,
            upvote_count: 12,
            opponent_upvote_count: 9,
            opponent: { kind: 'listed', handle: 'rival', name: 'Rival' },
          },
        ],
      },
    ]);
  });

  test.each([
    ['相手のいないマッチ', { kind: 'none' }, { kind: 'none' }],
    ['非公開の相手', { kind: 'private' }, { kind: 'private' }],
    [
      '可視だが未掲載の相手はハンドルを出さずに名称だけ',
      { kind: 'unlisted', productId: RIVAL_ID },
      { kind: 'unlisted', name: 'Rival' },
    ],
    [
      '掲載中の相手はハンドルと名称',
      { kind: 'listed', productId: RIVAL_ID },
      { kind: 'listed', handle: 'rival', name: 'Rival' },
    ],
    [
      '読み取れなかった相手は非公開',
      { kind: 'listed', productId: '01JD0PR0D00000000000000009' },
      { kind: 'private' },
    ],
  ] satisfies [string, OpponentView, LaunchMatchOpponent][])(
    '%sを表す',
    (_name, opponent, expected) => {
      const [launch] = toLaunches(
        productPageOf({ launches: [launchOf([rowOf({ opponent })])] }),
      );

      expect(launch?.matches[0]?.opponent).toEqual(expected);
    },
  );

  test.each([
    ['qualifier', null, null],
    ['week', 1, 'quarterfinal'],
    ['year', 3, 'final'],
  ] as const)('マッチの種別%sとラウンド・段階を写す', (kind, round, stage) => {
    const [launch] = toLaunches(
      productPageOf({
        launches: [launchOf([rowOf({ kind, round, stage })])],
      }),
    );

    expect(launch?.matches[0]).toMatchObject({ kind, round, stage });
  });

  test('不戦勝・早期の終了の結果と決着の方法をそのまま写し、相手のUpvote数はnullのままにする', () => {
    const [launch] = toLaunches(
      productPageOf({
        launches: [
          launchOf([
            rowOf({
              result: 'walkover',
              decision: 'walkover',
              endedEarly: true,
              opponentUpvoteCount: null,
              opponent: { kind: 'private' },
            }),
          ]),
        ],
      }),
    );

    expect(launch?.matches[0]).toMatchObject({
      result: 'walkover',
      decision: 'walkover',
      ended_early: true,
      opponent_upvote_count: null,
    });
  });

  test('キックオフ前のローンチは確定したマッチを持たない空の一覧にする', () => {
    const [launch] = toLaunches(
      productPageOf({
        launches: [
          launchOf([], {
            status: 'scheduled',
            outcome: null,
            decidedAt: null,
            summary: { label: 'キックオフ予定', inMatch: false },
            kickedOff: false,
          }),
        ],
      }),
    );

    expect(launch).toMatchObject({
      status: 'scheduled',
      summary: 'キックオフ予定',
      matches: [],
    });
  });
});

describe('プロダクトカテゴリの写像', () => {
  test('ハンドルと名称だけを写す', () => {
    const category: ProductCategoryRecord = {
      id: '01JD0CATG00000000000000001',
      name: 'ツール',
      handle: 'tools',
      systemDefault: false,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    };

    expect(toProductCategory(category)).toEqual({
      handle: 'tools',
      name: 'ツール',
    });
  });
});
