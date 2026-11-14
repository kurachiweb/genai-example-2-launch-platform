import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { emailSuppressions } from '../../../db/schema/email/email-suppressions.ts';
import {
  mergeSuppression,
  SUPPRESSION_REASONS,
  type SuppressionReason,
  type SuppressionState,
} from '../../core/email/suppression-policy.ts';
import type { Clock } from '../../core/time/clock.ts';
import { createSuppressionRepository } from './suppression-repository.ts';

const MAX_BOUND_PARAMETERS = 100;

const NOW = new Date('2026-10-27T03:04:05.678Z');

const db = createDatabase(env.DB);

function clockAt(instant: Date): Clock {
  return { now: () => new Date(instant) };
}

function at(iso: string): Date {
  return new Date(iso);
}

function state(
  lastReason: SuppressionReason,
  lastEventAt: string,
  expiresAt: string | null,
): SuppressionState {
  return {
    lastReason,
    lastEventAt: at(lastEventAt),
    expiresAt: expiresAt === null ? null : at(expiresAt),
  };
}

function addressOf(index: number): string {
  return `recipient-${String(index).padStart(4, '0')}@recipient.example`;
}

async function readRows() {
  return db.select().from(emailSuppressions).orderBy(emailSuppressions.address);
}

async function readState(
  address: string,
): Promise<SuppressionState | undefined> {
  const [row] = await db
    .select({
      lastReason: emailSuppressions.lastReason,
      lastEventAt: emailSuppressions.lastEventAt,
      expiresAt: emailSuppressions.expiresAt,
    })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.address, address));
  return row;
}

interface RecordingD1 {
  readonly d1: D1Database;
  readonly placeholderCounts: number[];
}

// 問い合わせの有無と分割の仕方を確かめるため、D1へ渡した各文のプレースホルダーの数を記録する
function createRecordingD1(): RecordingD1 {
  const placeholderCounts: number[] = [];
  const d1: D1Database = {
    prepare: (query) => {
      placeholderCounts.push(query.match(/\?/g)?.length ?? 0);
      return env.DB.prepare(query);
    },
    batch: (statements) => env.DB.batch(statements),
    exec: (query) => env.DB.exec(query),
    withSession: (constraint) => env.DB.withSession(constraint),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも実装する
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { d1, placeholderCounts };
}

beforeEach(async () => {
  await db.delete(emailSuppressions);
});

describe('抑止リストの理由の型', () => {
  test('DBスキーマのlast_reasonと抑止の方針の理由が相互に代入できる', () => {
    expectTypeOf<
      (typeof emailSuppressions.$inferSelect)['lastReason']
    >().toEqualTypeOf<SuppressionReason>();
    expectTypeOf<
      (typeof emailSuppressions.$inferInsert)['lastReason']
    >().toEqualTypeOf<SuppressionReason>();
  });
});

describe('createSuppressionRepository', () => {
  describe('record', () => {
    test('新しい宛先は照合キーで与えた状態のまま記録し、作成・更新日時を時計の時刻にする', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));

      await repository.record(
        '  User.Name@Recipient.Example ',
        state('rejected', '2026-10-20T00:00:00Z', '2026-10-27T00:00:00Z'),
      );

      expect(await readRows()).toEqual([
        {
          id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/) as unknown,
          address: 'user.name@recipient.example',
          lastReason: 'rejected',
          lastEventAt: at('2026-10-20T00:00:00Z'),
          expiresAt: at('2026-10-27T00:00:00Z'),
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
    });

    test('大文字小文字だけ違う宛先は同じ記録へ合成し、作成日時を保って更新日時を進める', async () => {
      const later = new Date(NOW.getTime() + 60_000);
      await createSuppressionRepository(db, clockAt(NOW)).record(
        'user@recipient.example',
        state('rejected', '2026-10-20T00:00:00Z', '2026-10-27T00:00:00Z'),
      );

      await createSuppressionRepository(db, clockAt(later)).record(
        'USER@Recipient.example',
        state('hard_bounce', '2026-10-21T00:00:00Z', null),
      );

      const rows = await readRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        address: 'user@recipient.example',
        lastReason: 'hard_bounce',
        lastEventAt: at('2026-10-21T00:00:00Z'),
        expiresAt: null,
        createdAt: NOW,
        updatedAt: later,
      });
    });

    test('合成の規則の表のすべての組で、D1上の結果が抑止の方針の合成と一致する', async () => {
      const instants = [
        '2026-09-15T07:40:00Z',
        '2026-09-15T07:40:00.001Z',
        '2026-09-16T07:40:00Z',
      ];
      const expiries = [null, '2026-09-22T07:40:00Z', '2026-09-23T07:40:00Z'];
      const candidates = SUPPRESSION_REASONS.flatMap((reason) =>
        instants.flatMap((instant) =>
          expiries.map((expiry) => state(reason, instant, expiry)),
        ),
      );
      const pairs = candidates.flatMap((existing) =>
        candidates.map((incoming) => ({ existing, incoming })),
      );
      const repository = createSuppressionRepository(db, clockAt(NOW));

      await Promise.all(
        pairs.map(({ existing }, index) =>
          repository.record(addressOf(index), existing),
        ),
      );
      await Promise.all(
        pairs.map(({ incoming }, index) =>
          repository.record(addressOf(index).toUpperCase(), incoming),
        ),
      );

      const rows = await readRows();
      expect(rows).toHaveLength(pairs.length);
      const actual = rows.map(({ lastReason, lastEventAt, expiresAt }) => ({
        lastReason,
        lastEventAt,
        expiresAt,
      }));
      const expected = pairs.map(({ existing, incoming }) =>
        mergeSuppression(existing, incoming),
      );
      expect(actual).toEqual(expected);
    });

    test('同じ契機を重ねて記録しても、1回記録した場合と同じ内容に保つ', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      const incoming = state(
        'rejected',
        '2026-10-20T00:00:00Z',
        '2026-10-27T00:00:00Z',
      );

      await repository.record('user@recipient.example', incoming);
      await repository.record('user@recipient.example', incoming);
      await repository.record('User@Recipient.Example', incoming);

      expect(await readRows()).toHaveLength(1);
      expect(await readState('user@recipient.example')).toEqual(incoming);
    });

    test('3つの契機の到着順によらず同じ内容になる', async () => {
      const arrivals = [
        state('rejected', '2026-10-20T00:00:00Z', '2026-10-27T00:00:00Z'),
        state('complaint', '2026-10-18T00:00:00Z', null),
        state('rejected', '2026-10-22T00:00:00Z', '2026-10-29T00:00:00Z'),
      ] as const;
      const [a, b, c] = arrivals;
      const orders = [
        [a, b, c],
        [a, c, b],
        [b, a, c],
        [b, c, a],
        [c, a, b],
        [c, b, a],
      ];
      const repository = createSuppressionRepository(db, clockAt(NOW));

      for (const [index, order] of orders.entries()) {
        for (const incoming of order) {
          await repository.record(addressOf(index), incoming);
        }
      }

      const states = await Promise.all(
        orders.map((_, index) => readState(addressOf(index))),
      );
      expect(new Set(states.map((merged) => JSON.stringify(merged))).size).toBe(
        1,
      );
      expect(states[0]).toEqual(
        state('rejected', '2026-10-22T00:00:00Z', null),
      );
    });
  });

  describe('getStatus', () => {
    test('記録の無い宛先は抑止中でない', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));

      await expect(
        repository.getStatus('user@recipient.example'),
      ).resolves.toEqual({ suppressed: false });
    });

    test('期限なしの記録は、最後の契機の種類・日時と期限なしを付けて抑止中として返す', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      await repository.record(
        'user@recipient.example',
        state('complaint', '2026-10-20T00:00:00Z', null),
      );

      await expect(
        repository.getStatus('user@recipient.example'),
      ).resolves.toEqual({
        suppressed: true,
        lastReason: 'complaint',
        lastEventAt: at('2026-10-20T00:00:00Z'),
        expiresAt: null,
      });
    });

    test('大文字小文字と前後の空白が違うアドレスで照会しても同じ記録に一致する', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      await repository.record(
        'User.Name@Recipient.Example',
        state('hard_bounce', '2026-10-20T00:00:00Z', null),
      );

      const status = await repository.getStatus(
        ' USER.name@recipient.EXAMPLE ',
      );

      expect(status.suppressed).toBe(true);
    });

    test('期限の直前までは抑止中とし、期限の時刻とその後は抑止中として扱わない', async () => {
      const expiresAt = at('2026-10-27T00:00:00Z');
      await createSuppressionRepository(db, clockAt(NOW)).record(
        'user@recipient.example',
        state('rejected', '2026-10-20T00:00:00Z', '2026-10-27T00:00:00Z'),
      );
      const statusAt = (instant: Date) =>
        createSuppressionRepository(db, clockAt(instant)).getStatus(
          'user@recipient.example',
        );

      await expect(
        statusAt(new Date(expiresAt.getTime() - 1)),
      ).resolves.toEqual({
        suppressed: true,
        lastReason: 'rejected',
        lastEventAt: at('2026-10-20T00:00:00Z'),
        expiresAt,
      });
      await expect(statusAt(expiresAt)).resolves.toEqual({
        suppressed: false,
      });
      await expect(statusAt(NOW)).resolves.toEqual({ suppressed: false });
    });
  });

  describe('findSuppressed', () => {
    test('抑止中の宛先だけを照合キーの集合で返し、期限切れと記録の無い宛先を含めない', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      await repository.record(
        'forever@recipient.example',
        state('hard_bounce', '2026-10-20T00:00:00Z', null),
      );
      await repository.record(
        'active@recipient.example',
        state('rejected', '2026-10-25T00:00:00Z', '2026-11-01T00:00:00Z'),
      );
      await repository.record(
        'expired@recipient.example',
        state('rejected', '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z'),
      );

      const suppressed = await repository.findSuppressed([
        'Forever@Recipient.Example',
        ' ACTIVE@recipient.example',
        'expired@recipient.example',
        'unknown@recipient.example',
      ]);

      expect(suppressed).toEqual(
        new Set(['forever@recipient.example', 'active@recipient.example']),
      );
    });

    test('空の一覧ではD1へ問い合わせずに空の集合を返す', async () => {
      const recording = createRecordingD1();
      const repository = createSuppressionRepository(
        createDatabase(recording.d1),
        clockAt(NOW),
      );

      await expect(repository.findSuppressed([])).resolves.toEqual(new Set());
      expect(recording.placeholderCounts).toEqual([]);
    });

    test('101件以上の宛先も、各文のバインド変数を上限内に分割して照会する', async () => {
      const total = 205;
      const seeding = createSuppressionRepository(db, clockAt(NOW));
      await Promise.all(
        Array.from({ length: total }, (_, index) =>
          seeding.record(
            addressOf(index),
            state('complaint', '2026-10-20T00:00:00Z', null),
          ),
        ),
      );
      const recording = createRecordingD1();
      const repository = createSuppressionRepository(
        createDatabase(recording.d1),
        clockAt(NOW),
      );
      const queried = [
        ...Array.from({ length: total }, (_, index) =>
          addressOf(index).toUpperCase(),
        ),
        'unknown@recipient.example',
      ];

      const suppressed = await repository.findSuppressed(queried);

      expect(suppressed).toEqual(
        new Set(Array.from({ length: total }, (_, index) => addressOf(index))),
      );
      expect(recording.placeholderCounts.length).toBeGreaterThan(1);
      expect(Math.max(...recording.placeholderCounts)).toBeLessThanOrEqual(
        MAX_BOUND_PARAMETERS,
      );
    });
  });

  describe('deleteByKeys', () => {
    test('指定した照合キーの記録だけを物理削除し、削除した件数を返す', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      for (const address of [
        'keep@recipient.example',
        'delete-a@recipient.example',
        'delete-b@recipient.example',
      ]) {
        await repository.record(
          address,
          state('hard_bounce', '2026-10-20T00:00:00Z', null),
        );
      }

      const deleted = await repository.deleteByKeys([
        'delete-a@recipient.example',
        'Delete-B@Recipient.Example',
      ]);

      expect(deleted).toBe(2);
      expect((await readRows()).map((row) => row.address)).toEqual([
        'keep@recipient.example',
      ]);
    });

    test('対象が無くても成功し、同じ削除を繰り返しても結果を変えない', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      await repository.record(
        'delete@recipient.example',
        state('hard_bounce', '2026-10-20T00:00:00Z', null),
      );

      await expect(
        repository.deleteByKeys(['delete@recipient.example']),
      ).resolves.toBe(1);
      await expect(
        repository.deleteByKeys(['delete@recipient.example']),
      ).resolves.toBe(0);
      await expect(
        repository.deleteByKeys(['unknown@recipient.example']),
      ).resolves.toBe(0);
      await expect(repository.deleteByKeys([])).resolves.toBe(0);
      expect(await readRows()).toEqual([]);
    });

    test('101件以上の照合キーも、各文のバインド変数を上限内に分割して削除する', async () => {
      const total = 205;
      const seeding = createSuppressionRepository(db, clockAt(NOW));
      await Promise.all(
        Array.from({ length: total + 1 }, (_, index) =>
          seeding.record(
            addressOf(index),
            state('complaint', '2026-10-20T00:00:00Z', null),
          ),
        ),
      );
      const recording = createRecordingD1();
      const repository = createSuppressionRepository(
        createDatabase(recording.d1),
        clockAt(NOW),
      );

      const deleted = await repository.deleteByKeys(
        Array.from({ length: total }, (_, index) => addressOf(index)),
      );

      expect(deleted).toBe(total);
      expect((await readRows()).map((row) => row.address)).toEqual([
        addressOf(total),
      ]);
      expect(Math.max(...recording.placeholderCounts)).toBeLessThanOrEqual(
        MAX_BOUND_PARAMETERS,
      );
    });
  });

  describe('deleteExpired', () => {
    test('期限が基準の時刻以前の記録だけを物理削除し、期限なし・期限内の記録を残す', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      await repository.record(
        'forever@recipient.example',
        state('hard_bounce', '2026-01-01T00:00:00Z', null),
      );
      await repository.record(
        'active@recipient.example',
        state('rejected', '2026-10-20T00:00:00Z', '2026-10-27T03:04:05.679Z'),
      );
      await repository.record(
        'boundary@recipient.example',
        state('rejected', '2026-10-20T00:00:00Z', '2026-10-27T03:04:05.678Z'),
      );
      await repository.record(
        'expired@recipient.example',
        state('rejected', '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z'),
      );

      const deleted = await repository.deleteExpired(NOW);

      expect(deleted).toBe(2);
      expect((await readRows()).map((row) => row.address)).toEqual([
        'active@recipient.example',
        'forever@recipient.example',
      ]);
    });

    test('同じ基準で繰り返しても成功し、2回目は何も削除しない', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      await repository.record(
        'expired@recipient.example',
        state('rejected', '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z'),
      );

      await expect(repository.deleteExpired(NOW)).resolves.toBe(1);
      await expect(repository.deleteExpired(NOW)).resolves.toBe(0);
    });
  });

  describe('listLastEventBefore', () => {
    const CUTOFF = at('2025-10-27T03:04:05.678Z');

    beforeEach(async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));
      const records: readonly [string, SuppressionState][] = [
        [
          'delta@recipient.example',
          state('hard_bounce', '2025-01-01T00:00:00Z', null),
        ],
        [
          'alpha@recipient.example',
          state('complaint', '2025-06-01T00:00:00Z', null),
        ],
        [
          'echo@recipient.example',
          state('hard_bounce', '2025-10-27T03:04:05.677Z', null),
        ],
        [
          'charlie@recipient.example',
          state('hard_bounce', '2024-12-31T00:00:00Z', null),
        ],
        [
          'boundary@recipient.example',
          state('hard_bounce', '2025-10-27T03:04:05.678Z', null),
        ],
        [
          'recent@recipient.example',
          state('complaint', '2026-10-01T00:00:00Z', null),
        ],
      ];
      for (const [address, recorded] of records) {
        await repository.record(address, recorded);
      }
    });

    test('最後の契機が基準より古い記録の照合キーを、昇順に上限の件数まで返す', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));

      await expect(
        repository.listLastEventBefore(CUTOFF, 3, undefined),
      ).resolves.toEqual([
        'alpha@recipient.example',
        'charlie@recipient.example',
        'delta@recipient.example',
      ]);
    });

    test('前のページの最後の照合キーより後だけを返し、続けて辿ると対象を漏れなく1回ずつ返す', async () => {
      const repository = createSuppressionRepository(db, clockAt(NOW));

      const second = await repository.listLastEventBefore(
        CUTOFF,
        3,
        'delta@recipient.example',
      );
      const third = await repository.listLastEventBefore(
        CUTOFF,
        3,
        'echo@recipient.example',
      );

      expect(second).toEqual(['echo@recipient.example']);
      expect(third).toEqual([]);
    });
  });
});
