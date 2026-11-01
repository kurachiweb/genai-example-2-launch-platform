import { describe, expect, test } from 'bun:test';

import {
  type ClaimFailureReason,
  type ClaimResult,
  type ModerationRecord,
  type NewMediaFileRecord,
  OWNER_ID_LIST_MAX_LIMIT,
  OWNER_OPERATION_BATCH_LIMIT,
  type OwnerBatchResult,
  QUARANTINED_IMAGE_LIST_MAX_LIMIT,
  type UploadOutcome,
} from './ports.ts';

describe('OWNER_OPERATION_BATCH_LIMIT', () => {
  test('保有者単位の操作は1回の呼び出しで1,000件まで処理する', () => {
    expect(OWNER_OPERATION_BATCH_LIMIT).toBe(1000);
  });
});

describe('OWNER_ID_LIST_MAX_LIMIT', () => {
  test('保有者の識別子の列挙は1回の呼び出しで500件まで返す', () => {
    expect(OWNER_ID_LIST_MAX_LIMIT).toBe(500);
  });
});

describe('QUARANTINED_IMAGE_LIST_MAX_LIMIT', () => {
  test('理由ごとの隔離の一覧は1回の呼び出しで100件まで返す', () => {
    expect(QUARANTINED_IMAGE_LIST_MAX_LIMIT).toBe(100);
  });
});

describe('OwnerBatchResult', () => {
  test('処理した件数と残りの有無を持つ', () => {
    const result: OwnerBatchResult = { processed: 1000, hasMore: true };

    expect(result).toEqual({ processed: 1000, hasMore: true });
  });
});

describe('ClaimResult', () => {
  test('紐付けの失敗の理由は5種である', () => {
    const reasons = {
      not_found: true,
      not_stored: true,
      deleted: true,
      purpose_mismatch: true,
      owner_mismatch: true,
    } as const satisfies Record<ClaimFailureReason, true>;

    expect(Object.keys(reasons)).toHaveLength(5);
  });

  test('成功の結果は失敗の一覧を持てない', () => {
    const result: ClaimResult = {
      ok: true,
      // @ts-expect-error 成功の結果に失敗の一覧は無い
      failures: [],
    };

    expect(result.ok).toBe(true);
  });

  test('失敗の結果はファイルごとの理由の一覧を持つ', () => {
    const result: ClaimResult = {
      ok: false,
      failures: [{ fileId: 'file-1', reason: 'owner_mismatch' }],
    };

    expect(result.ok).toBe(false);
  });
});

describe('ModerationRecord', () => {
  test('不適切の記録だけが検出内容を持つ', () => {
    const flagged: ModerationRecord = {
      verdict: 'flagged',
      findings: [{ source: 'unprocessable', reason: 'undecodable' }],
    };
    const passed: ModerationRecord = {
      verdict: 'passed',
      // @ts-expect-error 問題なしの記録に検出内容は無い
      findings: [],
    };

    expect([flagged.verdict, passed.verdict]).toEqual(['flagged', 'passed']);
  });
});

describe('NewMediaFileRecord', () => {
  test('受付の時点の判定の状態は判定不要か判定待ちに限る', () => {
    const base = {
      id: '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1',
      objectKey: '0123456789abcdef'.repeat(2),
      purpose: 'product-logo',
      storage: 'images',
      owner: { kind: 'user', id: 'user-1' },
      originalFileName: 'logo.png',
      contentType: 'image/png',
      byteSize: 10,
      width: 1,
      height: 1,
    } as const;
    const pending: NewMediaFileRecord = {
      ...base,
      moderationStatus: 'pending',
    };
    const passed: NewMediaFileRecord = {
      ...base,
      // @ts-expect-error 判定の結果は受付の時点で記録しない
      moderationStatus: 'passed',
    };

    expect<readonly string[]>([
      pending.moderationStatus,
      passed.moderationStatus,
    ]).toEqual(['pending', 'passed']);
  });
});

describe('UploadOutcome', () => {
  test('拒否の結果はファイルの情報を持てない', () => {
    const outcome: UploadOutcome = {
      ok: false,
      rejection: {
        kind: 'unavailable',
        code: 'storage_unavailable',
        message: '一時的に利用できません。',
        retryAfterSeconds: 5,
      },
      // @ts-expect-error 拒否の結果にファイルの情報は無い
      file: undefined,
    };

    expect(outcome.ok).toBe(false);
  });
});
