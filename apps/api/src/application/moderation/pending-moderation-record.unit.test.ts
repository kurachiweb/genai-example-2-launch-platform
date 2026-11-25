import { describe, expect, test } from 'bun:test';

import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import {
  InMemoryPendingModerationRecord,
  type PendingModeration,
} from './pending-moderation-record.ts';

const USER_ID = '01J00000000000000000000001';
const OTHER_USER_ID = '01J00000000000000000000002';

const pendingSuspension = (
  overrides: Partial<PendingModeration> = {},
): PendingModeration => ({
  record: {
    id: '01J0000000000000000000000A',
    action: 'user.suspend',
    targetId: USER_ID,
    subjectUserId: USER_ID,
    productId: null,
    operatorAdminId: '01J0000000000000000000000B',
    reason: '規約違反の投稿を繰り返したため',
    noticeStatus: 'pending',
  },
  lifecycleEvent: 'suspended',
  audit: {
    id: '01J0000000000000000000000C',
    operatorAdminId: '01J0000000000000000000000B',
    action: 'user.suspend',
    targetKind: 'user',
    targetIds: ['pseudonym-1'],
    reason: '規約違反の投稿を繰り返したため',
    detail: {},
    occurredAt: new Date('2026-11-20T03:00:00.000Z'),
  } as unknown as PreparedAuditEntry,
  participation: undefined,
  ...overrides,
});

describe('InMemoryPendingModerationRecord', () => {
  test('置いた措置は種類と対象が一致したときだけ取り出せ、取り出した後は空になる', () => {
    const pending = new InMemoryPendingModerationRecord();
    const suspension = pendingSuspension();
    pending.set(suspension);

    expect(pending.take({ type: 'suspended', targetId: USER_ID })).toBe(
      suspension,
    );
    expect(
      pending.take({ type: 'suspended', targetId: USER_ID }),
    ).toBeUndefined();
  });

  test('種類か対象が一致しなければ取り出さず、措置は置いたまま残る', () => {
    const pending = new InMemoryPendingModerationRecord();
    const suspension = pendingSuspension();
    pending.set(suspension);

    expect(
      pending.take({ type: 'withdrawn', targetId: USER_ID }),
    ).toBeUndefined();
    expect(
      pending.take({ type: 'suspended', targetId: OTHER_USER_ID }),
    ).toBeUndefined();
    expect(pending.wasTaken()).toBe(false);
    expect(pending.take({ type: 'suspended', targetId: USER_ID })).toBe(
      suspension,
    );
  });

  test('何も置いていなければ取り出せない', () => {
    const pending = new InMemoryPendingModerationRecord();

    expect(
      pending.take({ type: 'suspended', targetId: USER_ID }),
    ).toBeUndefined();
    expect(pending.wasTaken()).toBe(false);
  });

  test('取り出しの有無は、置いた措置が取り出された後だけ真になる', () => {
    const pending = new InMemoryPendingModerationRecord();

    pending.set(pendingSuspension());
    expect(pending.wasTaken()).toBe(false);

    pending.take({ type: 'suspended', targetId: USER_ID });
    expect(pending.wasTaken()).toBe(true);
  });

  test('1つの要求に置けるのは1件だけで、置き済みの間に置くと例外を投げて先の措置を残す', () => {
    const pending = new InMemoryPendingModerationRecord();
    const suspension = pendingSuspension();
    pending.set(suspension);

    expect(() => {
      pending.set(
        pendingSuspension({
          lifecycleEvent: 'unsuspended',
          record: { ...suspension.record, action: 'user.unsuspend' },
        }),
      );
    }).toThrow(Error);
    expect(pending.take({ type: 'suspended', targetId: USER_ID })).toBe(
      suspension,
    );
  });

  test('破棄すると取り出せなくなり、次の措置を置ける', () => {
    const pending = new InMemoryPendingModerationRecord();
    pending.set(pendingSuspension());

    pending.clear();

    expect(
      pending.take({ type: 'suspended', targetId: USER_ID }),
    ).toBeUndefined();
    expect(pending.wasTaken()).toBe(false);

    const next = pendingSuspension({ lifecycleEvent: 'unsuspended' });
    pending.set(next);
    expect(pending.take({ type: 'unsuspended', targetId: USER_ID })).toBe(next);
  });

  test('取り出された後は次の措置を置け、取り出しの有無は新しい措置について答える', () => {
    const pending = new InMemoryPendingModerationRecord();
    pending.set(pendingSuspension());
    pending.take({ type: 'suspended', targetId: USER_ID });

    pending.set(pendingSuspension({ lifecycleEvent: 'unsuspended' }));

    expect(pending.wasTaken()).toBe(false);
  });

  test('呼び出し側の参加の値は中身を変えずにそのまま運ぶ', () => {
    const pending = new InMemoryPendingModerationRecord();
    const participation = {
      kind: 'content-reporting.report-resolution',
      payload: { reportIds: ['01J0000000000000000000000D'] },
    };
    pending.set(pendingSuspension({ participation }));

    expect(
      pending.take({ type: 'suspended', targetId: USER_ID })?.participation,
    ).toBe(participation);
  });
});
