import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { emailAlertThrottles } from '../../../db/schema/email/email-alert-throttles.ts';
import { createAlertThrottleRepository } from './alert-throttle-repository.ts';

const NAME = 'email-daily-limit';

const INTERVAL_SECONDS = 3600;

const NOW = new Date('2026-10-27T03:04:05.678Z');

const db = createDatabase(env.DB);

function secondsAfter(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}

async function readRows() {
  return db
    .select({
      name: emailAlertThrottles.name,
      lastReportedAt: emailAlertThrottles.lastReportedAt,
      createdAt: emailAlertThrottles.createdAt,
      updatedAt: emailAlertThrottles.updatedAt,
    })
    .from(emailAlertThrottles)
    .orderBy(emailAlertThrottles.name);
}

beforeEach(async () => {
  await db.delete(emailAlertThrottles);
});

describe('createAlertThrottleRepository', () => {
  describe('tryAcquire', () => {
    test('初めての名前では真を返し、報告日時と作成・更新日時を与えた時刻にした行を作る', async () => {
      const throttle = createAlertThrottleRepository(db);

      const acquired = await throttle.tryAcquire(NAME, NOW, INTERVAL_SECONDS);

      expect(acquired).toBe(true);
      expect(await readRows()).toEqual([
        { name: NAME, lastReportedAt: NOW, createdAt: NOW, updatedAt: NOW },
      ]);
      const [row] = await db.select().from(emailAlertThrottles);
      expect(row?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    test('間隔内の2回目以降は偽を返し、最後に報告した日時を進めない', async () => {
      const throttle = createAlertThrottleRepository(db);
      await throttle.tryAcquire(NAME, NOW, INTERVAL_SECONDS);

      const results = [
        await throttle.tryAcquire(NAME, NOW, INTERVAL_SECONDS),
        await throttle.tryAcquire(
          NAME,
          secondsAfter(NOW, INTERVAL_SECONDS - 1),
          INTERVAL_SECONDS,
        ),
      ];

      expect(results).toEqual([false, false]);
      expect(await readRows()).toEqual([
        { name: NAME, lastReportedAt: NOW, createdAt: NOW, updatedAt: NOW },
      ]);
    });

    test('間隔がちょうど経過した時刻からは真を返し、報告日時と更新日時を進めて作成日時を保つ', async () => {
      const throttle = createAlertThrottleRepository(db);
      await throttle.tryAcquire(NAME, NOW, INTERVAL_SECONDS);
      const elapsed = secondsAfter(NOW, INTERVAL_SECONDS);

      const acquired = await throttle.tryAcquire(
        NAME,
        elapsed,
        INTERVAL_SECONDS,
      );
      const again = await throttle.tryAcquire(
        NAME,
        secondsAfter(elapsed, 1),
        INTERVAL_SECONDS,
      );

      expect([acquired, again]).toEqual([true, false]);
      expect(await readRows()).toEqual([
        {
          name: NAME,
          lastReportedAt: elapsed,
          createdAt: NOW,
          updatedAt: elapsed,
        },
      ]);
    });

    test('大文字小文字だけ違う名前は同じ間引きとして扱う', async () => {
      const throttle = createAlertThrottleRepository(db);
      await throttle.tryAcquire(NAME, NOW, INTERVAL_SECONDS);

      const acquired = await throttle.tryAcquire(
        'EMAIL-Daily-Limit',
        secondsAfter(NOW, 1),
        INTERVAL_SECONDS,
      );

      expect(acquired).toBe(false);
      expect(await readRows()).toHaveLength(1);
    });

    test('異なる名前の間引きは互いに影響しない', async () => {
      const throttle = createAlertThrottleRepository(db);
      await throttle.tryAcquire(NAME, NOW, INTERVAL_SECONDS);

      const acquired = await throttle.tryAcquire(
        'email-other-alert',
        NOW,
        INTERVAL_SECONDS,
      );

      expect(acquired).toBe(true);
      expect((await readRows()).map((row) => row.name)).toEqual([
        NAME,
        'email-other-alert',
      ]);
    });

    test('同じ時刻に同時に呼ばれても、真を返すのは1回だけである', async () => {
      const throttle = createAlertThrottleRepository(db);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          throttle.tryAcquire(NAME, NOW, INTERVAL_SECONDS),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await readRows()).toHaveLength(1);
    });
  });
});
