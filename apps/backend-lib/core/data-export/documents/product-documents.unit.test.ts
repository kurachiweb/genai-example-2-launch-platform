import { describe, expect, test } from 'bun:test';

import { planArchive } from '../export-plan.ts';
import type {
  ExportAward,
  ExportFileView,
  ExportLaunch,
  ExportMatch,
  ExportProduct,
  ExportSnapshot,
} from '../export-snapshot.ts';
import type { DocumentInput } from './file-reference.ts';
import {
  buildLaunchesDocument,
  buildProductsDocument,
} from './product-documents.ts';

const PRODUCT_ID = '01J9B2Y4D6F8H0K2M4P6R8T0V2';
const LOGO_ID = '01LOGO0000000000000000000A';
const SHOT_ID = '01SHOT0000000000000000000A';
const QUARANTINED_SHOT_ID = '01SHOT0000000000000000000B';

function view(
  fileId: string,
  originalFileName: string,
  overrides: Partial<ExportFileView> = {},
): ExportFileView {
  return {
    fileId,
    originalFileName,
    contentType: 'image/png',
    byteSize: 1,
    quarantined: false,
    ...overrides,
  };
}

function exampleViews(): readonly ExportFileView[] {
  return [
    view(LOGO_ID, 'logo.png', { byteSize: 61_234 }),
    view(SHOT_ID, 'home.png', { byteSize: 154_892 }),
    view(QUARANTINED_SHOT_ID, 'home-2.png', {
      byteSize: 182_044,
      quarantined: true,
    }),
  ];
}

function product(overrides: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: PRODUCT_ID,
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    tagline: 'サッカー観戦メモをAIが試合ごとにまとめるアプリ',
    categoryName: 'AI',
    websiteUrl: 'https://pitch-notes.example/',
    descriptionMarkdown: '説明文',
    logoFileId: LOGO_ID,
    screenshotFileIds: [SHOT_ID, QUARANTINED_SHOT_ID],
    createdAt: new Date('2026-08-30T02:10:00.000Z'),
    updatedAt: new Date('2026-09-06T22:45:00.000Z'),
    deletedAt: null,
    hiddenByAdmin: false,
    ...overrides,
  };
}

function match(overrides: Partial<ExportMatch> = {}): ExportMatch {
  return {
    id: '01J9D4A6F8H0K2M4P6R8T0V2X4',
    kind: 'qualifier',
    round: null,
    date: '2026-09-07',
    upvoteCount: 12,
    opponentUpvoteCount: 9,
    lastUpvotedAt: new Date('2026-09-08T05:40:12.000Z'),
    result: 'won',
    ...overrides,
  };
}

function launch(overrides: Partial<ExportLaunch> = {}): ExportLaunch {
  return {
    id: '01J9B2Y4D65BHZ5XE90JSNS2J1',
    productId: PRODUCT_ID,
    launchDate: '2026-09-07',
    status: 'finished',
    matches: [match()],
    awards: [],
    ...overrides,
  };
}

function documentInput(
  overrides: {
    readonly products?: readonly ExportProduct[];
    readonly launches?: readonly ExportLaunch[];
    readonly views?: readonly ExportFileView[];
    readonly storeAll?: boolean;
  } = {},
): DocumentInput {
  const views = overrides.views ?? exampleViews();
  const snapshot = {
    requestedAt: new Date('2026-09-15T10:12:30.000Z'),
    products: overrides.products ?? [product()],
    launches: overrides.launches ?? [launch()],
    profile: { avatarFileId: null, bioMarkdown: null },
    comments: [],
    inquiries: [],
    files: new Map(views.map((item) => [item.fileId, item])),
  } as unknown as ExportSnapshot;
  const plan = planArchive(snapshot);
  const stored =
    overrides.storeAll === false
      ? new Set<string>()
      : new Set(plan.binaries.map((binary) => binary.fileId));
  return { snapshot, plan, stored };
}

describe('buildProductsDocument', () => {
  test('文書の例と同じ項目名・値・順で出力する', () => {
    const document = buildProductsDocument(documentInput());

    expect(document).toStrictEqual([
      {
        id: PRODUCT_ID,
        handle: 'pitch-notes',
        name: 'Pitch Notes',
        tagline: 'サッカー観戦メモをAIが試合ごとにまとめるアプリ',
        category: 'AI',
        websiteUrl: 'https://pitch-notes.example/',
        descriptionPath: 'products/pitch-notes/description.md',
        logoPath: 'products/pitch-notes/logo/logo.png',
        logoQuarantined: false,
        logoOriginalFileName: 'logo.png',
        logoContentType: 'image/png',
        logoSize: 61_234,
        screenshots: [
          {
            path: 'products/pitch-notes/screenshots/home.png',
            quarantined: false,
            originalFileName: 'home.png',
            contentType: 'image/png',
            size: 154_892,
          },
          {
            path: null,
            quarantined: true,
            originalFileName: 'home-2.png',
            contentType: 'image/png',
            size: 182_044,
          },
        ],
        createdAt: '2026-08-30T02:10:00.000Z',
        updatedAt: '2026-09-06T22:45:00.000Z',
        deletedAt: null,
        hiddenByAdmin: false,
      },
    ]);
    expect(Object.keys(document[0] ?? {})).toStrictEqual([
      'id',
      'handle',
      'name',
      'tagline',
      'category',
      'websiteUrl',
      'descriptionPath',
      'logoPath',
      'logoQuarantined',
      'logoOriginalFileName',
      'logoContentType',
      'logoSize',
      'screenshots',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'hiddenByAdmin',
    ]);
    expect(Object.keys(document[0]?.screenshots[0] ?? {})).toStrictEqual([
      'path',
      'quarantined',
      'originalFileName',
      'contentType',
      'size',
    ]);
  });

  test('プロダクトが無ければ空配列にする', () => {
    expect(
      buildProductsDocument(documentInput({ products: [] })),
    ).toStrictEqual([]);
  });

  test('論理削除の日時と管理者の非公開の印を書き、説明文のパスも残す', () => {
    const [entry] = buildProductsDocument(
      documentInput({
        products: [
          product({
            deletedAt: new Date('2026-09-10T01:02:03.004Z'),
            hiddenByAdmin: true,
          }),
        ],
      }),
    );

    expect(entry).toMatchObject({
      deletedAt: '2026-09-10T01:02:03.004Z',
      hiddenByAdmin: true,
      descriptionPath: 'products/pitch-notes/description.md',
    });
  });

  test('隔離されたロゴはパスをnullにして印とメタデータを残す', () => {
    const [entry] = buildProductsDocument(
      documentInput({
        views: [
          view(LOGO_ID, 'logo.png', { byteSize: 61_234, quarantined: true }),
          view(SHOT_ID, 'home.png'),
        ],
      }),
    );

    expect(entry).toMatchObject({
      logoPath: null,
      logoQuarantined: true,
      logoOriginalFileName: 'logo.png',
      logoContentType: 'image/png',
      logoSize: 61_234,
    });
  });

  test('記録の無いロゴは元のファイル名・形式・バイト数・隔離の印をnullにする', () => {
    const [entry] = buildProductsDocument(
      documentInput({ views: [view(SHOT_ID, 'home.png')] }),
    );

    expect(entry).toMatchObject({
      logoPath: null,
      logoQuarantined: null,
      logoOriginalFileName: null,
      logoContentType: null,
      logoSize: null,
    });
  });

  test('記録の無いスクリーンショットも項目ごと残してnullにする', () => {
    const [entry] = buildProductsDocument(
      documentInput({ views: [view(LOGO_ID, 'logo.png')] }),
    );

    expect(entry?.screenshots).toStrictEqual([
      {
        path: null,
        quarantined: null,
        originalFileName: null,
        contentType: null,
        size: null,
      },
      {
        path: null,
        quarantined: null,
        originalFileName: null,
        contentType: null,
        size: null,
      },
    ]);
  });

  test('格納できなかったファイルはパスだけをnullにする', () => {
    const [entry] = buildProductsDocument(documentInput({ storeAll: false }));

    expect(entry).toMatchObject({
      logoPath: null,
      logoQuarantined: false,
      logoOriginalFileName: 'logo.png',
    });
    expect(entry?.screenshots[0]).toMatchObject({
      path: null,
      quarantined: false,
      originalFileName: 'home.png',
    });
  });

  test('スクリーンショットが無ければ空配列にする', () => {
    const [entry] = buildProductsDocument(
      documentInput({ products: [product({ screenshotFileIds: [] })] }),
    );

    expect(entry?.screenshots).toStrictEqual([]);
  });

  test('複数のプロダクトを入力の順に書き、ディレクトリ名の連番を反映する', () => {
    const document = buildProductsDocument(
      documentInput({
        products: [
          product({ id: 'P1', handle: 'Alpha' }),
          product({ id: 'P2', handle: 'alpha' }),
        ],
        views: [],
      }),
    );

    expect(document.map((entry) => entry.id)).toStrictEqual(['P1', 'P2']);
    expect(document.map((entry) => entry.descriptionPath)).toStrictEqual([
      'products/Alpha/description.md',
      'products/alpha-2/description.md',
    ]);
  });

  test('入力に秘密情報や仮名化IDが紛れても出力へ写さない', () => {
    const polluted = {
      ...product(),
      pseudonymousId: 'pseudo-123',
      moderationReason: 'internal-reason',
    } as unknown as ExportProduct;

    const text = JSON.stringify(
      buildProductsDocument(documentInput({ products: [polluted] })),
    );

    expect(text).not.toContain('pseudo-123');
    expect(text).not.toContain('internal-reason');
  });

  test('説明文のパスを計画から引けなければ例外にする', () => {
    const input = documentInput();
    const broken: DocumentInput = {
      ...input,
      plan: { ...input.plan, productDirectories: new Map() },
    };

    expect(() => buildProductsDocument(broken)).toThrow(Error);
  });
});

describe('buildLaunchesDocument', () => {
  test('文書の例と同じ項目名・値・順で出力する', () => {
    const document = buildLaunchesDocument(
      documentInput({
        launches: [
          launch({
            matches: [
              match(),
              match({
                id: '01J9B2Y4D7T0PGVRJ4GYZ03HAV',
                kind: 'week',
                round: 1,
                date: '2026-09-15',
                upvoteCount: 0,
                opponentUpvoteCount: 0,
                lastUpvotedAt: null,
                result: 'lost',
              }),
            ],
          }),
        ],
      }),
    );

    expect(document).toStrictEqual([
      {
        id: '01J9B2Y4D65BHZ5XE90JSNS2J1',
        productId: PRODUCT_ID,
        launchDate: '2026-09-07',
        status: 'finished',
        matches: [
          {
            id: '01J9D4A6F8H0K2M4P6R8T0V2X4',
            kind: 'qualifier',
            round: null,
            date: '2026-09-07',
            upvoteCount: 12,
            opponentUpvoteCount: 9,
            lastUpvotedAt: '2026-09-08T05:40:12.000Z',
            result: 'won',
          },
          {
            id: '01J9B2Y4D7T0PGVRJ4GYZ03HAV',
            kind: 'week',
            round: 1,
            date: '2026-09-15',
            upvoteCount: 0,
            opponentUpvoteCount: 0,
            lastUpvotedAt: null,
            result: 'lost',
          },
        ],
        awards: [],
      },
    ]);
    expect(Object.keys(document[0] ?? {})).toStrictEqual([
      'id',
      'productId',
      'launchDate',
      'status',
      'matches',
      'awards',
    ]);
    expect(Object.keys(document[0]?.matches[0] ?? {})).toStrictEqual([
      'id',
      'kind',
      'round',
      'date',
      'upvoteCount',
      'opponentUpvoteCount',
      'lastUpvotedAt',
      'result',
    ]);
  });

  test('ローンチが無ければ空配列にする', () => {
    expect(
      buildLaunchesDocument(documentInput({ launches: [] })),
    ).toStrictEqual([]);
  });

  test('未確定のマッチのresultをnullにする', () => {
    const [entry] = buildLaunchesDocument(
      documentInput({
        launches: [
          launch({ status: 'in_progress', matches: [match({ result: null })] }),
        ],
      }),
    );

    expect(entry?.matches[0]?.result).toBeNull();
  });

  test('マッチが無いローンチはmatchesを空配列にする', () => {
    const [entry] = buildLaunchesDocument(
      documentInput({
        launches: [launch({ status: 'scheduled', matches: [] })],
      }),
    );

    expect(entry?.matches).toStrictEqual([]);
  });

  test('週間・年間の受賞を種類と期間で書く', () => {
    const awards: readonly ExportAward[] = [
      { kind: 'product_of_the_week', period: '2026-W37' },
      { kind: 'product_of_the_year', period: '2026' },
    ];

    const [entry] = buildLaunchesDocument(
      documentInput({ launches: [launch({ awards })] }),
    );

    expect(entry?.awards).toStrictEqual([
      { kind: 'product_of_the_week', period: '2026-W37' },
      { kind: 'product_of_the_year', period: '2026' },
    ]);
    expect(Object.keys(entry?.awards[0] ?? {})).toStrictEqual([
      'kind',
      'period',
    ]);
  });

  test('基準時刻のUTCの8:00をまたぐ最終Upvote時間もUTCのままミリ秒付きで書く', () => {
    const [entry] = buildLaunchesDocument(
      documentInput({
        launches: [
          launch({
            matches: [
              match({ lastUpvotedAt: new Date('2026-09-08T07:59:59.999Z') }),
            ],
          }),
        ],
      }),
    );

    expect(entry?.matches[0]?.lastUpvotedAt).toBe('2026-09-08T07:59:59.999Z');
  });

  test('取消のローンチと不戦勝・相手の退会による勝利をそのまま書く', () => {
    const document = buildLaunchesDocument(
      documentInput({
        launches: [
          launch({
            id: 'L1',
            status: 'canceled',
            matches: [match({ result: 'bye', opponentUpvoteCount: 0 })],
          }),
          launch({ id: 'L2', matches: [match({ result: 'walkover' })] }),
        ],
      }),
    );

    expect(document.map((entry) => entry.status)).toStrictEqual([
      'canceled',
      'finished',
    ]);
    expect(document.map((entry) => entry.matches[0]?.result)).toStrictEqual([
      'bye',
      'walkover',
    ]);
  });

  test('入力に仮名化IDが紛れても出力へ写さない', () => {
    const polluted = {
      ...launch(),
      pseudonymousId: 'pseudo-123',
      matches: [{ ...match(), opponentUserId: 'opponent-user' }],
    } as unknown as ExportLaunch;

    const text = JSON.stringify(
      buildLaunchesDocument(documentInput({ launches: [polluted] })),
    );

    expect(text).not.toContain('pseudo-123');
    expect(text).not.toContain('opponent-user');
  });
});
