import { beforeEach, describe, expect, test } from 'vitest';

import { emailSuppressions } from '../../../db/schema/email/email-suppressions.ts';
import type { SuppressionList } from '../../../lib/core/email/ports.ts';
import type { SuppressionReason } from '../../../lib/core/email/suppression-policy.ts';
import type { UserContactDirectory } from '../../../lib/core/identity/ports.ts';
import type { NoticeSuppressionReason } from '../../../lib/core/notifications/notice-copy.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { createSuppressionRepository } from '../../../lib/workers/email/suppression-repository.ts';
import { D1UserContactDirectory } from '../../../lib/workers/identity/d1-user-contact-directory.ts';
import {
  after,
  clearNotificationTables,
  db,
  insertRecipient,
  recipientIdOf,
  T0,
} from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { SuppressionDeliveryStatusReader } from './delivery-status-reader.ts';

const NOW = new Date('2026-11-20T03:00:00.000Z');

const HOUR_MILLISECONDS = 3_600_000;

const clock: Clock = { now: () => new Date(NOW) };

const suppressions = createSuppressionRepository(db, clock);

const contacts = new D1UserContactDirectory(db);

const reader = new SuppressionDeliveryStatusReader(contacts, suppressions);

async function suppress(
  address: string,
  reason: SuppressionReason,
  expiresAt: Date | null,
): Promise<void> {
  await suppressions.record(address, {
    lastReason: reason,
    lastEventAt: T0,
    expiresAt,
  });
}

beforeEach(async () => {
  await db.delete(emailSuppressions);
  await clearNotificationTables();
});

describe('SuppressionDeliveryStatusReader', () => {
  describe('statusOf', () => {
    test('連絡先のメールアドレスが除外されていなければ配信できる状態を返す', async () => {
      await insertRecipient(1, { email: 'owner@mail.example' });

      await expect(reader.statusOf(recipientIdOf(1))).resolves.toEqual({
        kind: 'deliverable',
      });
    });

    test.each([
      ['hard_bounce', 'bounce'],
      ['complaint', 'complaint'],
    ] as const satisfies readonly (readonly [
      SuppressionReason,
      NoticeSuppressionReason,
    ])[])(
      '連絡先のメールアドレスが%sで除外されていれば理由を%sに写し、期限を持たない',
      async (reason, expected) => {
        await insertRecipient(1, { email: 'owner@mail.example' });
        await suppress('owner@mail.example', reason, null);

        await expect(reader.statusOf(recipientIdOf(1))).resolves.toEqual({
          kind: 'suppressed',
          reason: expected,
          until: null,
        });
      },
    );

    test('受信側の拒否による期限付きの除外は理由と除外が解ける日時を返す', async () => {
      const until = new Date(NOW.getTime() + HOUR_MILLISECONDS);
      await insertRecipient(1, { email: 'owner@mail.example' });
      await suppress('owner@mail.example', 'rejected', until);

      await expect(reader.statusOf(recipientIdOf(1))).resolves.toEqual({
        kind: 'suppressed',
        reason: 'rejected',
        until,
      });
    });

    test('大文字を含む連絡先のメールアドレスも照合キーで除外を見つける', async () => {
      await insertRecipient(1, { email: 'Owner.Name@Mail.Example' });
      await suppress('owner.name@mail.example', 'hard_bounce', null);

      await expect(reader.statusOf(recipientIdOf(1))).resolves.toEqual({
        kind: 'suppressed',
        reason: 'bounce',
        until: null,
      });
    });

    test('期限を過ぎた除外は配信できる状態として返す', async () => {
      await insertRecipient(1, { email: 'owner@mail.example' });
      await suppress(
        'owner@mail.example',
        'rejected',
        new Date(NOW.getTime() - HOUR_MILLISECONDS),
      );

      await expect(reader.statusOf(recipientIdOf(1))).resolves.toEqual({
        kind: 'deliverable',
      });
    });

    test('他の利用者のメールアドレスの除外を混ぜない', async () => {
      await insertRecipient(1, { email: 'first@mail.example' });
      await insertRecipient(2, { email: 'second@mail.example' });
      await suppress('second@mail.example', 'complaint', null);

      await expect(reader.statusOf(recipientIdOf(1))).resolves.toEqual({
        kind: 'deliverable',
      });
    });

    test('停止中の利用者の除外も返す', async () => {
      await insertRecipient(1, {
        email: 'owner@mail.example',
        status: 'suspended',
        suspendedAt: after(1),
      });
      await suppress('owner@mail.example', 'complaint', null);

      await expect(reader.statusOf(recipientIdOf(1))).resolves.toEqual({
        kind: 'suppressed',
        reason: 'complaint',
        until: null,
      });
    });

    test('退会済みで連絡先が無い利用者はunknownを返す', async () => {
      await insertRecipient(1, {
        email: 'owner@mail.example',
        deletedAt: after(1),
      });
      await suppress('owner@mail.example', 'complaint', null);

      await expect(reader.statusOf(recipientIdOf(1))).resolves.toEqual({
        kind: 'unknown',
      });
    });

    test('存在しない利用者はunknownを返す', async () => {
      await expect(reader.statusOf(recipientIdOf(999))).resolves.toEqual({
        kind: 'unknown',
      });
    });

    test('連絡先の照会の例外はunknownを返す', async () => {
      const failingContacts: UserContactDirectory = {
        findContact: () => Promise.reject(new Error('連絡先の照会の失敗')),
      };

      await expect(
        new SuppressionDeliveryStatusReader(
          failingContacts,
          suppressions,
        ).statusOf(recipientIdOf(1)),
      ).resolves.toEqual({ kind: 'unknown' });
    });

    test('抑止の照会の例外はunknownを返す', async () => {
      await insertRecipient(1, { email: 'owner@mail.example' });
      const failingSuppressions: SuppressionList = {
        getStatus: () => Promise.reject(new Error('抑止の照会の失敗')),
        findSuppressed: () => Promise.reject(new Error('テストでは使わない')),
      };

      await expect(
        new SuppressionDeliveryStatusReader(
          contacts,
          failingSuppressions,
        ).statusOf(recipientIdOf(1)),
      ).resolves.toEqual({ kind: 'unknown' });
    });
  });
});
