import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { emailSendRecords } from '../../../db/schema/email/email-send-records.ts';
import { createSendRecordRepository } from './send-record-repository.ts';

const REQUEST_ID = '01JBD8G7Q3Z6W0K8N5S2X4Y9TA';
const OTHER_REQUEST_ID = '01JBD8G7Q3Z6W0K8N5S2X4Y9TB';

const KIND = 'test-domain.notice';
const IDEMPOTENCY_KEY = '01JQ0ACT000000000000000001';
const OTHER_IDEMPOTENCY_KEY = '01JQ0ACT000000000000000002';

const SENT_AT = new Date('2026-10-27T03:04:05.678Z');

const RETENTION_MILLISECONDS = 14 * 24 * 60 * 60 * 1000;

const db = createDatabase(env.DB);

function requestIdOf(index: number): string {
  return `01JBD8G7Q3Z6W0K8N5S2X4Y${String(index).padStart(3, '0')}`;
}

async function readRows() {
  return db.select().from(emailSendRecords).orderBy(emailSendRecords.id);
}

beforeEach(async () => {
  await db.delete(emailSendRecords);
});

describe('createSendRecordRepository', () => {
  describe('markSent', () => {
    test('送信要求の識別子を主キーとして、種別・送信日時と、送信日時を作成・更新日時にした行だけを保存する', async () => {
      const repository = createSendRecordRepository(db);

      await repository.markSent(REQUEST_ID, 'email-delivery-smoke', SENT_AT);

      expect(await readRows()).toEqual([
        {
          id: REQUEST_ID,
          kind: 'email-delivery-smoke',
          idempotencyKey: null,
          sentAt: SENT_AT,
          createdAt: SENT_AT,
          updatedAt: SENT_AT,
        },
      ]);
    });

    test('同じ識別子の2回目の記録は成功するが、行を増やさず最初の内容を保つ', async () => {
      const repository = createSendRecordRepository(db);
      await repository.markSent(REQUEST_ID, 'email-delivery-smoke', SENT_AT);

      await repository.markSent(
        REQUEST_ID,
        'another-kind',
        new Date('2026-10-28T00:00:00.000Z'),
      );

      expect(await readRows()).toEqual([
        {
          id: REQUEST_ID,
          kind: 'email-delivery-smoke',
          idempotencyKey: null,
          sentAt: SENT_AT,
          createdAt: SENT_AT,
          updatedAt: SENT_AT,
        },
      ]);
    });

    test('異なる識別子はそれぞれ別の行として記録する', async () => {
      const repository = createSendRecordRepository(db);

      await repository.markSent(REQUEST_ID, 'email-delivery-smoke', SENT_AT);
      await repository.markSent(
        OTHER_REQUEST_ID,
        'email-delivery-smoke',
        SENT_AT,
      );

      expect((await readRows()).map((row) => row.id)).toEqual([
        REQUEST_ID,
        OTHER_REQUEST_ID,
      ]);
    });
  });

  describe('hasSent', () => {
    test('記録した識別子は送信済みとし、記録の無い識別子は送信済みとしない', async () => {
      const repository = createSendRecordRepository(db);
      await repository.markSent(REQUEST_ID, 'email-delivery-smoke', SENT_AT);

      const results = await Promise.all([
        repository.hasSent(REQUEST_ID),
        repository.hasSent(OTHER_REQUEST_ID),
      ]);

      expect(results).toEqual([true, false]);
    });

    test('冪等のキーを渡すと、識別子が違っても同じ種別で同じキーの記録があれば送信済みとする', async () => {
      const repository = createSendRecordRepository(db);
      await repository.markSent(REQUEST_ID, KIND, SENT_AT, IDEMPOTENCY_KEY);

      const results = await Promise.all([
        repository.hasSent(OTHER_REQUEST_ID, {
          kind: KIND,
          key: IDEMPOTENCY_KEY,
        }),
        repository.hasSent(OTHER_REQUEST_ID, {
          kind: 'another-domain.kind',
          key: IDEMPOTENCY_KEY,
        }),
        repository.hasSent(OTHER_REQUEST_ID, {
          kind: KIND,
          key: OTHER_IDEMPOTENCY_KEY,
        }),
        repository.hasSent(OTHER_REQUEST_ID),
      ]);

      expect(results).toEqual([true, false, false, false]);
    });

    test('冪等のキーを渡しても、同じ識別子の記録があれば送信済みとする', async () => {
      const repository = createSendRecordRepository(db);
      await repository.markSent(REQUEST_ID, KIND, SENT_AT);

      await expect(
        repository.hasSent(REQUEST_ID, { kind: KIND, key: IDEMPOTENCY_KEY }),
      ).resolves.toBe(true);
    });
  });

  describe('markSentの冪等のキー', () => {
    test('冪等のキーを識別子・種別・送信日時と一緒に保存する', async () => {
      const repository = createSendRecordRepository(db);

      await repository.markSent(REQUEST_ID, KIND, SENT_AT, IDEMPOTENCY_KEY);

      expect(await readRows()).toEqual([
        {
          id: REQUEST_ID,
          kind: KIND,
          idempotencyKey: IDEMPOTENCY_KEY,
          sentAt: SENT_AT,
          createdAt: SENT_AT,
          updatedAt: SENT_AT,
        },
      ]);
    });

    test('同じ種別で同じキーの2回目の記録は、識別子が違っても成功し、行を増やさない', async () => {
      const repository = createSendRecordRepository(db);
      await repository.markSent(REQUEST_ID, KIND, SENT_AT, IDEMPOTENCY_KEY);

      await repository.markSent(
        OTHER_REQUEST_ID,
        KIND,
        new Date('2026-10-28T00:00:00.000Z'),
        IDEMPOTENCY_KEY,
      );

      expect((await readRows()).map((row) => row.id)).toEqual([REQUEST_ID]);
    });

    test('種別が違えば同じキーでも別の行として記録する', async () => {
      const repository = createSendRecordRepository(db);

      await repository.markSent(REQUEST_ID, KIND, SENT_AT, IDEMPOTENCY_KEY);
      await repository.markSent(
        OTHER_REQUEST_ID,
        'another-domain.kind',
        SENT_AT,
        IDEMPOTENCY_KEY,
      );

      expect((await readRows()).map((row) => row.id)).toEqual([
        REQUEST_ID,
        OTHER_REQUEST_ID,
      ]);
    });
  });

  describe('deleteSentBefore', () => {
    test('送信日時が基準日時より古い行だけを物理削除し、ちょうど基準日時の行とそれより新しい行を残す', async () => {
      const repository = createSendRecordRepository(db);
      const cutoff = new Date(SENT_AT.getTime() - RETENTION_MILLISECONDS);
      const sentAts = [
        new Date(cutoff.getTime() - 24 * 60 * 60 * 1000),
        new Date(cutoff.getTime() - 1),
        cutoff,
        new Date(cutoff.getTime() + 1),
        SENT_AT,
      ];
      for (const [index, sentAt] of sentAts.entries()) {
        await repository.markSent(
          requestIdOf(index),
          'email-delivery-smoke',
          sentAt,
        );
      }

      const deleted = await repository.deleteSentBefore(cutoff);

      expect(deleted).toBe(2);
      expect((await readRows()).map((row) => row.sentAt)).toEqual([
        cutoff,
        new Date(cutoff.getTime() + 1),
        SENT_AT,
      ]);
    });

    test('対象が無くても成功し、同じ削除を繰り返しても結果を変えない', async () => {
      const repository = createSendRecordRepository(db);
      await repository.markSent(REQUEST_ID, 'email-delivery-smoke', SENT_AT);
      const cutoff = new Date(SENT_AT.getTime() + 1);

      const first = await repository.deleteSentBefore(cutoff);
      const second = await repository.deleteSentBefore(cutoff);

      expect([first, second]).toEqual([1, 0]);
      expect(await readRows()).toEqual([]);
    });
  });
});
