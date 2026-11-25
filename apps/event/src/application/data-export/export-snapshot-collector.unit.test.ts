import { describe, expect, test } from 'bun:test';

import type {
  ExportFileView,
  ExportInquiry,
  ExportProduct,
} from '../../../lib/core/data-export/export-snapshot.ts';
import type {
  AccountSource,
  AccountSourceReader,
} from './sources/account-source-reader.ts';
import type {
  CorrespondenceSource,
  CorrespondenceSourceReader,
} from './sources/correspondence-source-reader.ts';
import type {
  ProductActivitySource,
  ProductActivitySourceReader,
} from './sources/product-activity-source-reader.ts';
import type { ExportFileResolver } from './export-file-resolver.ts';
import { ExportSnapshotCollector } from './export-snapshot-collector.ts';

const USER_ID = '01JD0USER00000000000000001';
const PSEUDONYMOUS_ID = 'PSEUDONYM-1';
const REQUESTED_AT = new Date('2026-11-22T00:00:00.000Z');
const NOW = new Date('2026-11-22T00:05:00.000Z');
const AT = new Date('2026-11-01T00:00:00.000Z');

function accountSource(avatarFileId: string | null): AccountSource {
  return {
    pseudonymousId: PSEUDONYMOUS_ID,
    account: {
      email: 'user@example.com',
      emailVerifiedAt: AT,
      registeredAt: AT,
      mfaEnabled: false,
      plan: null,
      notificationSettings: null,
      apiKeys: [],
    },
    profile: {
      handle: 'user-one',
      nickname: 'ユーザー',
      headline: null,
      bioMarkdown: null,
      avatarFileId,
      websites: [],
      updatedAt: AT,
    },
    follows: [],
  };
}

function product(
  id: string,
  logoFileId: string,
  screenshotFileIds: readonly string[],
): ExportProduct {
  return {
    id,
    handle: `product-${id}`,
    name: `プロダクト${id}`,
    tagline: 'タグライン',
    categoryName: '開発ツール',
    websiteUrl: 'https://product.example/',
    descriptionMarkdown: '説明',
    logoFileId,
    screenshotFileIds,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    hiddenByAdmin: false,
  };
}

function inquiry(attachmentFileIds: readonly string[]): ExportInquiry {
  return {
    id: 'I-1',
    category: '不具合',
    status: 'open',
    createdAt: AT,
    messages: [
      {
        id: 'I-1-M1',
        sender: 'user',
        adminNickname: null,
        body: '困っています',
        attachments: attachmentFileIds.map((fileId) => ({
          fileId,
          originalFileName: `${fileId}.png`,
          contentType: 'image/png',
          size: 10,
        })),
        createdAt: AT,
      },
    ],
  };
}

function fileView(fileId: string): ExportFileView {
  return {
    fileId,
    originalFileName: `${fileId}.png`,
    contentType: 'image/png',
    byteSize: 10,
    quarantined: false,
  };
}

interface Data {
  readonly account?: AccountSource | undefined;
  readonly activity?: Partial<ProductActivitySource>;
  readonly correspondence?: Partial<CorrespondenceSource>;
}

function createCollector(data: Data = {}) {
  const calls: string[] = [];
  const accountArgs: unknown[][] = [];
  const activityArgs: unknown[][] = [];
  const correspondenceArgs: unknown[][] = [];
  const resolveArgs: (readonly string[])[] = [];
  const account = 'account' in data ? data.account : accountSource('F-AVATAR');
  const accountReader: Pick<AccountSourceReader, 'read'> = {
    read: (...args) => {
      calls.push('account');
      accountArgs.push(args);
      return Promise.resolve(account);
    },
  };
  const activityReader: Pick<ProductActivitySourceReader, 'read'> = {
    read: (...args) => {
      calls.push('activity');
      activityArgs.push(args);
      return Promise.resolve({
        products: [],
        launches: [],
        comments: [],
        upvotes: [],
        ratings: [],
        ...data.activity,
      });
    },
  };
  const correspondenceReader: Pick<CorrespondenceSourceReader, 'read'> = {
    read: (...args) => {
      calls.push('correspondence');
      correspondenceArgs.push(args);
      return Promise.resolve({
        reports: [],
        inquiries: [],
        sponsorships: [],
        payments: [],
        ...data.correspondence,
      });
    },
  };
  const resolver: Pick<ExportFileResolver, 'resolve'> = {
    resolve: (fileIds) => {
      calls.push('resolve');
      resolveArgs.push(fileIds);
      return Promise.resolve(
        new Map(fileIds.map((fileId) => [fileId, fileView(fileId)])),
      );
    },
  };
  return {
    collector: new ExportSnapshotCollector(
      accountReader as AccountSourceReader,
      activityReader as ProductActivitySourceReader,
      correspondenceReader as CorrespondenceSourceReader,
      resolver as ExportFileResolver,
    ),
    calls,
    accountArgs,
    activityArgs,
    correspondenceArgs,
    resolveArgs,
  };
}

describe('ExportSnapshotCollector', () => {
  test('アカウントが無いときは他の読み取りもファイルの照会も呼ばずundefinedを返す', async () => {
    const { collector, calls } = createCollector({ account: undefined });

    const result = await collector.collect(USER_ID, REQUESTED_AT, NOW);

    expect(result).toBeUndefined();
    expect(calls).toEqual(['account']);
  });

  test('3つの読み取りの結果とファイルの照会から1つのスナップショットを返す', async () => {
    const products = [product('P-1', 'F-LOGO', ['F-SHOT-1'])];
    const inquiries = [inquiry(['F-ATT-1'])];
    const { collector } = createCollector({
      activity: { products },
      correspondence: { inquiries },
    });

    const snapshot = await collector.collect(USER_ID, REQUESTED_AT, NOW);

    expect(snapshot?.requestedAt).toBe(REQUESTED_AT);
    expect(snapshot?.account.email).toBe('user@example.com');
    expect(snapshot?.profile.handle).toBe('user-one');
    expect(snapshot?.products).toBe(products);
    expect(snapshot?.inquiries).toBe(inquiries);
    expect(snapshot?.launches).toEqual([]);
    expect(snapshot?.comments).toEqual([]);
    expect(snapshot?.upvotes).toEqual([]);
    expect(snapshot?.ratings).toEqual([]);
    expect(snapshot?.follows).toEqual([]);
    expect(snapshot?.reports).toEqual([]);
    expect(snapshot?.sponsorships).toEqual([]);
    expect(snapshot?.payments).toEqual([]);
    expect([...(snapshot?.files.keys() ?? [])].toSorted()).toEqual([
      'F-ATT-1',
      'F-AVATAR',
      'F-LOGO',
      'F-SHOT-1',
    ]);
  });

  test('仮名化IDをスナップショットに入れない', async () => {
    const { collector } = createCollector();

    const snapshot = await collector.collect(USER_ID, REQUESTED_AT, NOW);

    expect(JSON.stringify(snapshot)).not.toContain(PSEUDONYMOUS_ID);
  });

  test('各読み取りへ利用者のIDと基準の日時を渡し、やり取りと取引の読み取りへは仮名化IDも渡す', async () => {
    const { collector, accountArgs, activityArgs, correspondenceArgs } =
      createCollector();

    await collector.collect(USER_ID, REQUESTED_AT, NOW);

    expect(accountArgs).toEqual([[USER_ID, NOW]]);
    expect(activityArgs).toEqual([[USER_ID, NOW]]);
    expect(correspondenceArgs).toEqual([[USER_ID, PSEUDONYMOUS_ID, NOW]]);
  });

  test('アイコン・ロゴ・スクリーンショット・問い合わせの添付のIDを重複を除いて1回で照会する', async () => {
    const { collector, resolveArgs, calls } = createCollector({
      activity: {
        products: [
          product('P-1', 'F-LOGO-1', ['F-SHOT-1', 'F-SHOT-2']),
          product('P-2', 'F-LOGO-1', ['F-SHOT-1']),
        ],
      },
      correspondence: { inquiries: [inquiry(['F-ATT-1', 'F-ATT-1'])] },
    });

    await collector.collect(USER_ID, REQUESTED_AT, NOW);

    expect(resolveArgs).toHaveLength(1);
    expect([...(resolveArgs[0] ?? [])].toSorted()).toEqual([
      'F-ATT-1',
      'F-AVATAR',
      'F-LOGO-1',
      'F-SHOT-1',
      'F-SHOT-2',
    ]);
    expect(calls).toEqual(['account', 'activity', 'correspondence', 'resolve']);
  });

  test('アイコンが無い利用者のアイコンは照会しない', async () => {
    const { collector, resolveArgs } = createCollector({
      account: accountSource(null),
    });

    await collector.collect(USER_ID, REQUESTED_AT, NOW);

    expect(resolveArgs).toEqual([[]]);
  });

  test('読み取りの例外はそのまま投げる', async () => {
    const failure = new Error('読み取りに失敗しました');
    const failing = new ExportSnapshotCollector(
      { read: () => Promise.resolve(accountSource(null)) } as never,
      { read: () => Promise.reject(failure) } as never,
      { read: () => Promise.resolve({}) } as never,
      { resolve: () => Promise.resolve(new Map()) } as never,
    );

    const caught = await failing
      .collect(USER_ID, REQUESTED_AT, NOW)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });
});
