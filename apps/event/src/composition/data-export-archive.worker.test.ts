import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { DATA_EXPORT_ARCHIVE_READY_EMAIL } from '../../lib/core/email/kinds/data-export.ts';
import { attachmentDisposition } from '../../lib/core/media/file-name.ts';
import { exportIdOf } from '../../lib/workers/data-export/testing/data-export-fixtures.ts';
import {
  commentIdOf,
  launchIdOf,
  productIdOf,
  T0,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { matchIdOf } from '../../lib/workers/match/testing/match-fixtures.ts';
import { reportIdOf } from '../../lib/workers/reporting/testing/report-erasure-fixtures.ts';
import { sponsorshipIdOf } from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import {
  archiveKeyOf,
  deadLetterCount,
  dispatch,
  EXPORT,
  generateEnvelope,
  HOUR_MS,
  installQueueSpies,
  OWNER_EMAIL,
  readArchive,
  seedQueuedExport,
  sentEmails,
} from './testing/data-export-archive-harness.ts';
import {
  ADMIN_MESSAGE_ID,
  at,
  AVATAR_BYTES,
  clearAll,
  emptyBuckets,
  INQUIRY_ID,
  OWN_DELETED_PRODUCT,
  OWN_PRODUCT,
  PAYMENT_IDS,
  readExport,
  RECEIPT_BYTES,
  REQUESTED_AT,
  SCREENSHOT_A_BYTES,
  SCREENSHOT_B_BYTES,
  seedOwnerData,
  USER_MESSAGE_ID,
} from './testing/data-export-archive-seed.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const ZIP_FILE_NAME = 'launch-stadium-export-Exporter-20261121.zip';

const ATTACHMENT_PATH = `inquiries/${INQUIRY_ID}/${USER_MESSAGE_ID}/領収書- 2026-.pdf`;

const RETENTION_MS = 7 * 24 * HOUR_MS;

type ArchiveFiles = Awaited<ReturnType<typeof readArchive>>['files'];

function textOf(files: ArchiveFiles, path: string): string {
  const content = files[path];
  if (content === undefined) {
    throw new Error(`ZIPに${path}が無い`);
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    content,
  );
}

function jsonOf(files: ArchiveFiles, path: string): unknown {
  return JSON.parse(textOf(files, path));
}

function iso(offsetMs: number): string {
  return at(offsetMs).toISOString();
}

const TACTICS_BOARD = { name: 'Tactics Board', handle: 'tactics-board' };

const PITCH_NOTES = { name: 'Pitch Notes', handle: 'pitch-notes' };

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearAll();
  await emptyBuckets();
  await seedOwnerData();
  installQueueSpies();
  await seedQueuedExport();
  await expect(dispatch(generateEnvelope())).resolves.toStrictEqual({
    acked: true,
    retried: false,
  });
});

afterEach(() => {
  expect(deadLetterCount()).toBe(0);
  vi.restoreAllMocks();
});

describe('生成したZIPの構造', () => {
  test('パスの一覧が文書の構造と一致し、画像と添付の実体は元のバイト列のまま格納される', async () => {
    const { files } = await readArchive();

    expect(Object.keys(files).toSorted()).toStrictEqual(
      [
        'README.txt',
        'manifest.json',
        'account.json',
        'profile.json',
        'profile/bio.md',
        'profile/avatar/avatar.png',
        'products.json',
        'products/pitch-notes/description.md',
        'products/pitch-notes/screenshots/home.png',
        'products/pitch-notes/screenshots/home-2.png',
        'products/old-product/description.md',
        'launches.json',
        'comments.json',
        ...[1, 2, 3, 4].map((index) => `comments/${commentIdOf(index)}.md`),
        'upvotes.json',
        'ratings.json',
        'follows.json',
        'reports.json',
        'inquiries.json',
        ATTACHMENT_PATH,
        'sponsorships.json',
        'payments.json',
      ].toSorted(),
    );
    expect(files['profile/avatar/avatar.png']).toStrictEqual(AVATAR_BYTES);
    expect(files['products/pitch-notes/screenshots/home.png']).toStrictEqual(
      SCREENSHOT_A_BYTES,
    );
    expect(files['products/pitch-notes/screenshots/home-2.png']).toStrictEqual(
      SCREENSHOT_B_BYTES,
    );
    expect(files[ATTACHMENT_PATH]).toStrictEqual(RECEIPT_BYTES);
  });

  test('隔離されたロゴ・実体の無い添付・他の利用者のコメントはZIPに含まれない', async () => {
    const { files } = await readArchive();
    const paths = Object.keys(files);

    expect(paths.filter((path) => path.includes('/logo/'))).toStrictEqual([]);
    expect(paths.filter((path) => path.includes('vanished'))).toStrictEqual([]);
    expect(paths).not.toContain(`comments/${commentIdOf(5)}.md`);
  });

  test('画像と添付は圧縮せずに格納し、テキストだけを圧縮し、非ASCIIのファイル名にUTF-8の印が付く', async () => {
    const { entries, files } = await readArchive();

    expect(entries.map(({ path }) => path).toSorted()).toStrictEqual(
      Object.keys(files).toSorted(),
    );
    for (const entry of entries) {
      const isBinary =
        entry.path.endsWith('.png') || entry.path.endsWith('.pdf');
      expect(entry.method, entry.path).toBe(isBinary ? 0 : 8);
    }
    expect(entries.filter(({ method }) => method === 0)).toHaveLength(4);
    const nonAscii = entries.filter(({ path }) => /[^ -~]/u.test(path));
    expect(nonAscii.map(({ path }) => path)).toStrictEqual([ATTACHMENT_PATH]);
    expect(nonAscii.every(({ utf8 }) => utf8)).toBe(true);
  });

  test('保存先のメタデータと、完了した記録のファイル名・大きさ・有効期限が設定される', async () => {
    const { object, bytes } = await readArchive();
    const row = await readExport(EXPORT);

    expect(object.httpMetadata).toMatchObject({
      contentType: 'application/zip',
      contentDisposition: attachmentDisposition(ZIP_FILE_NAME),
      cacheControl: 'private, no-store',
    });
    expect(row).toMatchObject({
      status: 'ready',
      fileName: ZIP_FILE_NAME,
      byteSize: bytes.length,
      objectKey: archiveKeyOf(),
      noticeStatus: 'requested',
      failureKind: null,
    });
    expect(row?.completedAt).toBeInstanceOf(Date);
    expect(row?.expiresAt?.getTime()).toBe(
      (row?.completedAt?.getTime() ?? 0) + RETENTION_MS,
    );
  });

  test('JSONはBOMなし・LFで書かれ、manifestが構造のバージョン・要求日時・ハンドル・12のJSONの件数を持つ', async () => {
    const { files } = await readArchive();

    for (const path of Object.keys(files).filter((name) =>
      name.endsWith('.json'),
    )) {
      const text = textOf(files, path);
      expect(text.codePointAt(0), path).not.toBe(0xfe_ff);
      expect(text, path).not.toContain('\r');
      expect(text.endsWith('\n'), path).toBe(true);
    }
    expect(textOf(files, 'README.txt')).toContain(
      'Launch Stadiumをご利用いただきありがとうございます。',
    );
    expect(jsonOf(files, 'manifest.json')).toStrictEqual({
      schemaVersion: 1,
      service: 'Launch Stadium',
      requestedAt: REQUESTED_AT.toISOString(),
      user: { handle: 'Exporter' },
      files: [
        { path: 'account.json', kind: 'account', count: 1 },
        { path: 'profile.json', kind: 'profile', count: 1 },
        { path: 'products.json', kind: 'products', count: 2 },
        { path: 'launches.json', kind: 'launches', count: 2 },
        { path: 'comments.json', kind: 'comments', count: 4 },
        { path: 'upvotes.json', kind: 'upvotes', count: 2 },
        { path: 'ratings.json', kind: 'ratings', count: 2 },
        { path: 'follows.json', kind: 'follows', count: 1 },
        { path: 'reports.json', kind: 'reports', count: 3 },
        { path: 'inquiries.json', kind: 'inquiries', count: 1 },
        { path: 'sponsorships.json', kind: 'sponsorships', count: 1 },
        { path: 'payments.json', kind: 'payments', count: 4 },
      ],
    });
  });

  test('マークダウン本文が.mdファイルに分離され、論理削除済みのプロダクトの説明文も含まれる', async () => {
    const { files } = await readArchive();

    expect(textOf(files, 'profile/bio.md')).toBe('# 自己紹介\n\nこんにちは');
    expect(textOf(files, 'products/pitch-notes/description.md')).toBe(
      '## Pitch Notes\n\n説明文',
    );
    expect(textOf(files, 'products/old-product/description.md')).toBe(
      '説明文2',
    );
    expect(textOf(files, `comments/${commentIdOf(1)}.md`)).toBe('コメント1');
  });

  test('account.jsonとprofile.jsonが文書の項目と値を持ち、秘密情報と仮名化IDを含まない', async () => {
    const { files } = await readArchive();

    expect(jsonOf(files, 'account.json')).toStrictEqual({
      email: OWNER_EMAIL,
      emailVerifiedAt: iso(1000),
      registeredAt: T0.toISOString(),
      mfaEnabled: false,
      plan: null,
      notificationSettings: {
        matchPreview: false,
        matchResult: false,
        followedUserMatch: false,
        followedUserAward: false,
        suppressedReason: null,
      },
      apiKeys: [
        {
          name: 'My dashboard',
          scopes: {
            products: 'read',
            launches: 'read',
            upvotes: 'read',
            comments: 'read',
            ratings: 'read',
            profile: 'read_write',
            productDescriptions: 'none',
          },
          createdAt: iso(1800),
        },
      ],
    });
    expect(jsonOf(files, 'profile.json')).toStrictEqual({
      handle: 'Exporter',
      nickname: 'エクスポート太郎',
      headline: '個人開発者',
      bioPath: 'profile/bio.md',
      avatarPath: 'profile/avatar/avatar.png',
      avatarQuarantined: false,
      avatarOriginalFileName: 'avatar.png',
      avatarContentType: 'image/png',
      avatarSize: AVATAR_BYTES.length,
      websites: [{ name: '', url: 'https://github.example/exporter' }],
      updatedAt: iso(1600),
    });
    const allJson = Object.keys(files)
      .filter((path) => path.endsWith('.json'))
      .map((path) => textOf(files, path))
      .join('\n');
    expect(allJson).not.toContain('pseudonymous');
    expect(allJson).not.toContain('pbkdf2');
    expect(allJson).not.toContain('api-key-hash');
  });

  test('products.jsonが隔離・記録なし・論理削除・管理者の非公開をnullと印で表し、同名のスクリーンショットに連番を付ける', async () => {
    const { files } = await readArchive();

    expect(jsonOf(files, 'products.json')).toStrictEqual([
      {
        id: productIdOf(OWN_PRODUCT),
        handle: 'pitch-notes',
        name: 'Pitch Notes',
        tagline: 'サッカー観戦メモをAIがまとめるアプリ',
        category: 'AI',
        websiteUrl: 'https://product1.example/',
        descriptionPath: 'products/pitch-notes/description.md',
        logoPath: null,
        logoQuarantined: true,
        logoOriginalFileName: 'logo.png',
        logoContentType: 'image/png',
        logoSize: 777,
        screenshots: [
          {
            path: 'products/pitch-notes/screenshots/home.png',
            quarantined: false,
            originalFileName: 'home.png',
            contentType: 'image/png',
            size: SCREENSHOT_A_BYTES.length,
          },
          {
            path: 'products/pitch-notes/screenshots/home-2.png',
            quarantined: false,
            originalFileName: 'home.png',
            contentType: 'image/png',
            size: SCREENSHOT_B_BYTES.length,
          },
        ],
        createdAt: iso(3000),
        updatedAt: iso(3100),
        deletedAt: null,
        hiddenByAdmin: false,
      },
      {
        id: productIdOf(OWN_DELETED_PRODUCT),
        handle: 'old-product',
        name: 'Old Product',
        tagline: 'タグライン2',
        category: 'その他',
        websiteUrl: 'https://product2.example/',
        descriptionPath: 'products/old-product/description.md',
        logoPath: null,
        logoQuarantined: null,
        logoOriginalFileName: null,
        logoContentType: null,
        logoSize: null,
        screenshots: [],
        createdAt: iso(3200),
        updatedAt: iso(3300),
        deletedAt: iso(4100),
        hiddenByAdmin: true,
      },
    ]);
  });

  test('launches.jsonが各ローンチのマッチの成績を持ち、未確定のマッチの結果と最終Upvote時間をnullにする', async () => {
    const { files } = await readArchive();

    expect(jsonOf(files, 'launches.json')).toStrictEqual([
      {
        id: launchIdOf(1),
        productId: productIdOf(OWN_PRODUCT),
        launchDate: '2026-11-10',
        status: 'finished',
        matches: [
          {
            id: matchIdOf(1),
            kind: 'qualifier',
            round: null,
            date: '2026-11-10',
            upvoteCount: 12,
            opponentUpvoteCount: 9,
            lastUpvotedAt: iso(6000),
            result: 'won',
          },
        ],
        awards: [],
      },
      {
        id: launchIdOf(2),
        productId: productIdOf(OWN_PRODUCT),
        launchDate: '2026-11-12',
        status: 'finished',
        matches: [
          {
            id: matchIdOf(2),
            kind: 'week',
            round: 1,
            date: '2026-11-12',
            upvoteCount: 0,
            opponentUpvoteCount: 0,
            lastUpvotedAt: null,
            result: null,
          },
        ],
        awards: [],
      },
    ]);
  });

  test('comments.jsonが削除と非公開の印と、他人の論理削除済みのプロダクトのnullを持ち、他人のコメントを含めない', async () => {
    const { files } = await readArchive();

    expect(jsonOf(files, 'comments.json')).toStrictEqual([
      {
        id: commentIdOf(1),
        launchId: launchIdOf(1),
        product: PITCH_NOTES,
        parentCommentId: null,
        bodyPath: `comments/${commentIdOf(1)}.md`,
        createdAt: iso(8000),
        updatedAt: iso(8500),
        deletedAt: null,
        hiddenByAdmin: false,
      },
      {
        id: commentIdOf(2),
        launchId: launchIdOf(1),
        product: PITCH_NOTES,
        parentCommentId: commentIdOf(1),
        bodyPath: `comments/${commentIdOf(2)}.md`,
        createdAt: iso(8100),
        updatedAt: iso(8100),
        deletedAt: iso(8200),
        hiddenByAdmin: false,
      },
      {
        id: commentIdOf(3),
        launchId: launchIdOf(3),
        product: TACTICS_BOARD,
        parentCommentId: null,
        bodyPath: `comments/${commentIdOf(3)}.md`,
        createdAt: iso(8300),
        updatedAt: iso(8300),
        deletedAt: null,
        hiddenByAdmin: true,
      },
      {
        id: commentIdOf(4),
        launchId: launchIdOf(4),
        product: null,
        parentCommentId: null,
        bodyPath: `comments/${commentIdOf(4)}.md`,
        createdAt: iso(8600),
        updatedAt: iso(8600),
        deletedAt: null,
        hiddenByAdmin: false,
      },
    ]);
  });

  test('upvotes.jsonとratings.jsonとfollows.jsonが、他人の論理削除済みのプロダクトのnullと無効化の印を持ち、他人の行動と退会済みのフォロー先を含めない', async () => {
    const { files } = await readArchive();

    expect(jsonOf(files, 'upvotes.json')).toStrictEqual([
      {
        matchId: matchIdOf(1),
        matchKind: 'qualifier',
        matchDate: '2026-11-10',
        product: TACTICS_BOARD,
        upvotedAt: iso(7000),
      },
      {
        matchId: matchIdOf(3),
        matchKind: 'qualifier',
        matchDate: '2026-11-11',
        product: null,
        upvotedAt: iso(7100),
      },
    ]);
    expect(jsonOf(files, 'ratings.json')).toStrictEqual([
      {
        product: TACTICS_BOARD,
        score: 4,
        createdAt: iso(9000),
        updatedAt: iso(9500),
        invalidatedByAdmin: true,
      },
      {
        product: null,
        score: 2,
        createdAt: iso(9100),
        updatedAt: iso(9100),
        invalidatedByAdmin: false,
      },
    ]);
    expect(jsonOf(files, 'follows.json')).toStrictEqual([
      {
        user: { handle: 'other-maker', nickname: 'Other Maker' },
        followedAt: iso(2500),
      },
    ]);
  });

  test('reports.jsonが対象の参照を種別ごとに求め、解決できない対象をnullにし、他人の通報を含めない', async () => {
    const { files } = await readArchive();

    expect(jsonOf(files, 'reports.json')).toStrictEqual([
      {
        id: reportIdOf(1),
        targetType: 'comment',
        targetRef: commentIdOf(3),
        category: 'スパム',
        reason: '同じ宣伝文を投稿している',
        createdAt: iso(10_000),
      },
      {
        id: reportIdOf(2),
        targetType: 'product',
        targetRef: 'tactics-board',
        category: 'その他',
        reason: '申出者の理由2',
        createdAt: iso(10_100),
      },
      {
        id: reportIdOf(3),
        targetType: 'product',
        targetRef: null,
        category: 'その他',
        reason: '申出者の理由3',
        createdAt: iso(10_200),
      },
    ]);
  });

  test('inquiries.jsonが管理者の返信と実体の無い添付のパスのnullを含み、添付のパスはZIP内の実際の名前と一致する', async () => {
    const { files } = await readArchive();

    expect(jsonOf(files, 'inquiries.json')).toStrictEqual([
      {
        id: INQUIRY_ID,
        category: 'その他',
        status: 'resolved',
        createdAt: iso(11_000),
        messages: [
          {
            id: USER_MESSAGE_ID,
            sender: 'user',
            adminNickname: null,
            body: '領収書の宛名を変更できますか?',
            attachments: [
              {
                path: ATTACHMENT_PATH,
                contentType: 'application/pdf',
                size: RECEIPT_BYTES.length,
              },
              { path: null, contentType: 'application/pdf', size: 300 },
            ],
            createdAt: iso(11_000),
          },
          {
            id: ADMIN_MESSAGE_ID,
            sender: 'admin',
            adminNickname: null,
            body: '領収書ページから変更できます。',
            attachments: [],
            createdAt: iso(11_500),
          },
        ],
      },
    ]);
    expect(files[ATTACHMENT_PATH]).toBeDefined();
  });

  test('sponsorships.jsonとpayments.jsonが返金とチャージバックを含み、疎通確認と他人の決済を除く', async () => {
    const { files } = await readArchive();
    const sponsorshipId = sponsorshipIdOf(1);

    expect(jsonOf(files, 'sponsorships.json')).toStrictEqual([
      {
        id: sponsorshipId,
        product: PITCH_NOTES,
        tier: 'gold',
        startsOn: '2099-01-01',
        endsOn: '2099-01-07',
        days: 7,
        status: 'terminated',
        paymentId: PAYMENT_IDS.sponsorship,
        createdAt: iso(12_000),
      },
    ]);
    expect(jsonOf(files, 'payments.json')).toStrictEqual([
      {
        id: PAYMENT_IDS.sponsorship,
        kind: 'one_time',
        purpose: 'sponsorship',
        amount: 5600,
        currency: 'usd',
        quantity: 7,
        status: 'succeeded',
        stripeReference: 'cs_test_sponsorship',
        relatedId: sponsorshipId,
        occurredAt: iso(13_000),
      },
      {
        id: PAYMENT_IDS.subscription,
        kind: 'subscription',
        purpose: 'ultras',
        amount: 900,
        currency: 'usd',
        quantity: 1,
        status: 'succeeded',
        stripeReference: 'in_test_ultras',
        relatedId: null,
        occurredAt: iso(13_100),
      },
      {
        id: PAYMENT_IDS.refund,
        kind: 'refund',
        purpose: 'sponsorship',
        amount: -4800,
        currency: 'usd',
        quantity: null,
        status: 'succeeded',
        stripeReference: 're_test_sponsorship',
        relatedId: sponsorshipId,
        occurredAt: iso(13_200),
      },
      {
        id: PAYMENT_IDS.dispute,
        kind: 'dispute',
        purpose: 'sponsorship',
        amount: -5600,
        currency: 'usd',
        quantity: null,
        status: 'disputed',
        stripeReference: 'dp_test_sponsorship',
        relatedId: sponsorshipId,
        occurredAt: iso(13_300),
      },
    ]);
  });

  test('完了のメールの依頼は1回だけで、冪等のキーは要求のID、宛先は登録のメールアドレスである', () => {
    expect(sentEmails()).toStrictEqual([
      {
        kind: DATA_EXPORT_ARCHIVE_READY_EMAIL.name,
        to: OWNER_EMAIL,
        idempotencyKey: exportIdOf(EXPORT),
      },
    ]);
  });
});
