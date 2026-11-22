import { describe, expect, test } from 'bun:test';

import type {
  ExportComment,
  ExportFollow,
  ExportRating,
  ExportReport,
  ExportUpvote,
} from '../export-snapshot.ts';
import {
  buildCommentsDocument,
  buildFollowsDocument,
  buildRatingsDocument,
  buildReportsDocument,
  buildUpvotesDocument,
} from './activity-documents.ts';

const TACTICS_BOARD = { name: 'Tactics Board', handle: 'tactics-board' };

function comment(overrides: Partial<ExportComment> = {}): ExportComment {
  return {
    id: '01J9F6C8H0K2M4P6R8T0V2X4Z6',
    launchId: '01J9B2Y4D8TVPB5WY7K22X6PAS',
    product: TACTICS_BOARD,
    parentCommentId: null,
    bodyMarkdown: '本文',
    createdAt: new Date('2026-09-07T14:20:00.000Z'),
    editedAt: new Date('2026-09-07T14:25:00.000Z'),
    deletedAt: null,
    hiddenByAdmin: false,
    ...overrides,
  };
}

function upvote(overrides: Partial<ExportUpvote> = {}): ExportUpvote {
  return {
    matchId: '01J9C7E3G5K7M9P1R3T5V7X9Z1',
    matchKind: 'qualifier',
    matchDate: '2026-09-07',
    product: TACTICS_BOARD,
    upvotedAt: new Date('2026-09-07T14:15:00.000Z'),
    ...overrides,
  };
}

function rating(overrides: Partial<ExportRating> = {}): ExportRating {
  return {
    product: TACTICS_BOARD,
    score: 4,
    invalidatedByAdmin: false,
    createdAt: new Date('2026-09-07T14:20:00.000Z'),
    updatedAt: new Date('2026-09-09T08:00:00.000Z'),
    ...overrides,
  };
}

function follow(overrides: Partial<ExportFollow> = {}): ExportFollow {
  return {
    handle: 'maker_ai',
    nickname: 'Maker AI',
    followedAt: new Date('2026-05-11T03:33:00.000Z'),
    ...overrides,
  };
}

function report(overrides: Partial<ExportReport> = {}): ExportReport {
  return {
    id: '01J9H8E0K2M4P6R8T0V2X4Z6B8',
    targetType: 'comment',
    targetRef: '01J9B2Y4D9Z41MQ3NWJFHYZYCB',
    category: 'スパム',
    reason: '同じ宣伝文を複数のローンチに投稿している',
    createdAt: new Date('2026-09-08T01:00:00.000Z'),
    ...overrides,
  };
}

describe('buildCommentsDocument', () => {
  test('文書の例と同じ項目名・値・順で出力する', () => {
    const document = buildCommentsDocument([comment()]);

    expect(document).toEqual([
      {
        id: '01J9F6C8H0K2M4P6R8T0V2X4Z6',
        launchId: '01J9B2Y4D8TVPB5WY7K22X6PAS',
        product: { name: 'Tactics Board', handle: 'tactics-board' },
        parentCommentId: null,
        bodyPath: 'comments/01J9F6C8H0K2M4P6R8T0V2X4Z6.md',
        createdAt: '2026-09-07T14:20:00.000Z',
        updatedAt: '2026-09-07T14:25:00.000Z',
        deletedAt: null,
        hiddenByAdmin: false,
      },
    ]);
    expect(Object.keys(document[0] ?? {})).toEqual([
      'id',
      'launchId',
      'product',
      'parentCommentId',
      'bodyPath',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'hiddenByAdmin',
    ]);
  });

  test('編集していないコメントのupdatedAtは投稿日時にする', () => {
    const [entry] = buildCommentsDocument([comment({ editedAt: null })]);

    expect(entry?.updatedAt).toBe('2026-09-07T14:20:00.000Z');
  });

  test('返信の親のコメントIDを写す', () => {
    const [entry] = buildCommentsDocument([
      comment({ parentCommentId: '01J9F6C8H0K2M4P6R8T0V2X4Z0' }),
    ]);

    expect(entry?.parentCommentId).toBe('01J9F6C8H0K2M4P6R8T0V2X4Z0');
  });

  test('自身で削除した日時と管理者の非公開の印を残し、本文のパスも含める', () => {
    const [entry] = buildCommentsDocument([
      comment({
        deletedAt: new Date('2026-09-10T00:00:00.000Z'),
        hiddenByAdmin: true,
      }),
    ]);

    expect(entry?.deletedAt).toBe('2026-09-10T00:00:00.000Z');
    expect(entry?.hiddenByAdmin).toBe(true);
    expect(entry?.bodyPath).toBe('comments/01J9F6C8H0K2M4P6R8T0V2X4Z6.md');
  });

  test('プロダクトを解決できないコメントはproductをnullにする', () => {
    const [entry] = buildCommentsDocument([comment({ product: null })]);

    expect(entry?.product).toBeNull();
  });

  test('論理削除済みの自分のプロダクトの名称とハンドルをそのまま写す', () => {
    const [entry] = buildCommentsDocument([
      comment({ product: { name: '削除済みの製品', handle: 'gone-product' } }),
    ]);

    expect(entry?.product).toEqual({
      name: '削除済みの製品',
      handle: 'gone-product',
    });
  });

  test('本文のマークダウンをJSONへ含めない', () => {
    const json = JSON.stringify(
      buildCommentsDocument([comment({ bodyMarkdown: '秘密の本文' })]),
    );

    expect(json).not.toContain('秘密の本文');
  });

  test('入力の順を保つ', () => {
    const document = buildCommentsDocument([
      comment({ id: 'B' }),
      comment({ id: 'A' }),
    ]);

    expect(document.map((entry) => entry.id)).toEqual(['B', 'A']);
  });

  test('0件は空配列にする', () => {
    expect(buildCommentsDocument([])).toEqual([]);
  });
});

describe('buildUpvotesDocument', () => {
  test('文書の例と同じ項目名・値・順で出力する', () => {
    const document = buildUpvotesDocument([upvote()]);

    expect(document).toEqual([
      {
        matchId: '01J9C7E3G5K7M9P1R3T5V7X9Z1',
        matchKind: 'qualifier',
        matchDate: '2026-09-07',
        product: { name: 'Tactics Board', handle: 'tactics-board' },
        upvotedAt: '2026-09-07T14:15:00.000Z',
      },
    ]);
    expect(Object.keys(document[0] ?? {})).toEqual([
      'matchId',
      'matchKind',
      'matchDate',
      'product',
      'upvotedAt',
    ]);
  });

  test('紐付けを解除済みでプロダクトを解決できないUpvoteも項目ごと残しproductをnullにする', () => {
    const document = buildUpvotesDocument([upvote({ product: null })]);

    expect(document).toHaveLength(1);
    expect(document[0]?.product).toBeNull();
  });

  test('週間・年間のマッチの種類を写す', () => {
    const document = buildUpvotesDocument([
      upvote({ matchKind: 'week' }),
      upvote({ matchKind: 'year' }),
    ]);

    expect(document.map((entry) => entry.matchKind)).toEqual(['week', 'year']);
  });

  test('0件は空配列にする', () => {
    expect(buildUpvotesDocument([])).toEqual([]);
  });
});

describe('buildRatingsDocument', () => {
  test('文書の例と同じ項目名・値・順で出力する', () => {
    const document = buildRatingsDocument([rating()]);

    expect(document).toEqual([
      {
        product: { name: 'Tactics Board', handle: 'tactics-board' },
        score: 4,
        createdAt: '2026-09-07T14:20:00.000Z',
        updatedAt: '2026-09-09T08:00:00.000Z',
        invalidatedByAdmin: false,
      },
    ]);
    expect(Object.keys(document[0] ?? {})).toEqual([
      'product',
      'score',
      'createdAt',
      'updatedAt',
      'invalidatedByAdmin',
    ]);
  });

  test('管理者により無効化中の評価も除かずinvalidatedByAdminをtrueにする', () => {
    const document = buildRatingsDocument([
      rating({ invalidatedByAdmin: true, score: 1 }),
    ]);

    expect(document).toHaveLength(1);
    expect(document[0]?.invalidatedByAdmin).toBe(true);
    expect(document[0]?.score).toBe(1);
  });

  test('プロダクトを解決できない評価はproductをnullにする', () => {
    const [entry] = buildRatingsDocument([rating({ product: null })]);

    expect(entry?.product).toBeNull();
  });

  test('0件は空配列にする', () => {
    expect(buildRatingsDocument([])).toEqual([]);
  });
});

describe('buildFollowsDocument', () => {
  test('文書の例と同じく相手をuserオブジェクトにまとめて出力する', () => {
    const document = buildFollowsDocument([follow()]);

    expect(document).toEqual([
      {
        user: { handle: 'maker_ai', nickname: 'Maker AI' },
        followedAt: '2026-05-11T03:33:00.000Z',
      },
    ]);
    expect(Object.keys(document[0] ?? {})).toEqual(['user', 'followedAt']);
    expect(Object.keys(document[0]?.user ?? {})).toEqual([
      'handle',
      'nickname',
    ]);
  });

  test('0件は空配列にする', () => {
    expect(buildFollowsDocument([])).toEqual([]);
  });
});

describe('buildReportsDocument', () => {
  test('文書の例と同じ項目名・値・順で出力する', () => {
    const document = buildReportsDocument([report()]);

    expect(document).toEqual([
      {
        id: '01J9H8E0K2M4P6R8T0V2X4Z6B8',
        targetType: 'comment',
        targetRef: '01J9B2Y4D9Z41MQ3NWJFHYZYCB',
        category: 'スパム',
        reason: '同じ宣伝文を複数のローンチに投稿している',
        createdAt: '2026-09-08T01:00:00.000Z',
      },
    ]);
    expect(Object.keys(document[0] ?? {})).toEqual([
      'id',
      'targetType',
      'targetRef',
      'category',
      'reason',
      'createdAt',
    ]);
  });

  test('対象を解決できない通報は項目ごと残しtargetRefをnullにする', () => {
    const document = buildReportsDocument([
      report({ id: 'R1', targetType: 'user', targetRef: null }),
      report({ id: 'R2', targetType: 'product', targetRef: null }),
      report({ id: 'R3', targetType: 'comment', targetRef: null }),
    ]);

    expect(document.map((entry) => [entry.id, entry.targetRef])).toEqual([
      ['R1', null],
      ['R2', null],
      ['R3', null],
    ]);
  });

  test('ユーザーとプロダクトの通報は現在のハンドル文字列を写す', () => {
    const document = buildReportsDocument([
      report({ targetType: 'user', targetRef: 'maker_ai' }),
      report({ targetType: 'product', targetRef: 'tactics-board' }),
    ]);

    expect(document.map((entry) => entry.targetRef)).toEqual([
      'maker_ai',
      'tactics-board',
    ]);
  });

  test('対応ステータスや管理者の判断結果の項目を含めない', () => {
    const [entry] = buildReportsDocument([report()]);

    expect(Object.keys(entry ?? {})).not.toContain('status');
    expect(Object.keys(entry ?? {})).not.toContain('resolution');
  });

  test('0件は空配列にする', () => {
    expect(buildReportsDocument([])).toEqual([]);
  });
});
