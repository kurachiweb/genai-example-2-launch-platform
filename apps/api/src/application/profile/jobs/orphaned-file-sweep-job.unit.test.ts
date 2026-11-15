import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  MediaFiles,
  OwnerBatchResult,
  OwnerIdListInput,
  OwnerRef,
} from '../../../../lib/core/media/ports.ts';
import type { ProfileStore } from '../ports.ts';
import { PROFILE_TYPES } from '../profile-types.ts';
import {
  ORPHANED_FILE_SWEEP_JOB_DEFINITION,
  ORPHANED_FILE_SWEEP_LIMIT,
  ORPHANED_FILE_SWEEP_PAGE,
  OrphanedFileSweepJob,
} from './orphaned-file-sweep-job.ts';

const CATEGORY = 'api.application.profile';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const ownerIdOf = (index: number): string =>
  `01JC0USER${String(index).padStart(17, '0')}`;

const ownerIds = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => ownerIdOf(index + 1));

type EraseOutcome = OwnerBatchResult | Error;

interface Setup {
  readonly allOwners: readonly string[];
  readonly existing?: readonly string[];
  readonly erase?: (ownerId: string, call: number) => EraseOutcome;
}

function setup({ allOwners, existing = [], erase }: Setup) {
  const listCalls: OwnerIdListInput[] = [];
  const existenceCalls: (readonly string[])[] = [];
  const eraseCalls: OwnerRef[] = [];
  const callsPerOwner = new Map<string, number>();
  const sorted = allOwners.toSorted();
  const existingSet = new Set(existing);
  const media = {
    listOwnerIds(input: OwnerIdListInput) {
      listCalls.push(input);
      const rest = sorted.filter(
        (id) => input.after === undefined || id > input.after,
      );
      const page = rest.slice(0, input.limit);
      return Promise.resolve({
        ownerIds: page,
        next: rest.length > page.length ? page.at(-1) : undefined,
      });
    },
    eraseOwnedBy(owner: OwnerRef) {
      eraseCalls.push(owner);
      const call = (callsPerOwner.get(owner.id) ?? 0) + 1;
      callsPerOwner.set(owner.id, call);
      const outcome = erase?.(owner.id, call) ?? {
        processed: 1,
        hasMore: false,
      };
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
  } as unknown as MediaFiles;
  const profiles = {
    findExistingUserIds(ids: readonly string[]) {
      existenceCalls.push(ids);
      return Promise.resolve(
        new Set(ids.filter((id) => existingSet.has(id))) as ReadonlySet<string>,
      );
    },
  } as unknown as ProfileStore;
  return {
    job: new OrphanedFileSweepJob(media, profiles),
    listCalls,
    existenceCalls,
    eraseCalls,
  };
}

function logsOfJob() {
  return records
    .filter((record) => record.category.join('.') === CATEGORY)
    .map(({ level, properties }) => ({ level, properties }));
}

describe('ORPHANED_FILE_SWEEP_JOB_DEFINITION', () => {
  test('業務時刻4:21・order 600で、プロフィールのジョブの識別子を解決先にする', () => {
    expect(ORPHANED_FILE_SWEEP_JOB_DEFINITION).toEqual({
      name: 'user-profile-social.orphaned-file-sweep',
      at: { hour: 4, minute: 21 },
      order: 600,
      handler: PROFILE_TYPES.OrphanedFileSweepJob,
    });
  });

  test('定義は実行時に書き換えられない', () => {
    expect(Object.isFrozen(ORPHANED_FILE_SWEEP_JOB_DEFINITION)).toBe(true);
    expect(Object.isFrozen(ORPHANED_FILE_SWEEP_JOB_DEFINITION.at)).toBe(true);
  });
});

describe('定数', () => {
  test('保有者のIDは90件ずつ読み、削除の打ち切りの件数は1,000件である', () => {
    expect(ORPHANED_FILE_SWEEP_PAGE).toBe(90);
    expect(ORPHANED_FILE_SWEEP_LIMIT).toBe(1000);
  });
});

describe('OrphanedFileSweepJob.sweep', () => {
  test('保有者のIDを90件ずつ読み、続きが無くなるまで繰り返す', async () => {
    const { job, listCalls, existenceCalls } = setup({
      allOwners: ownerIds(200),
      existing: ownerIds(200),
    });

    const result = await job.sweep();

    expect(listCalls).toEqual([
      { kind: 'user', after: undefined, limit: 90 },
      { kind: 'user', after: ownerIdOf(90), limit: 90 },
      { kind: 'user', after: ownerIdOf(180), limit: 90 },
    ]);
    expect(existenceCalls.map((ids) => ids.length)).toEqual([90, 90, 20]);
    expect(result.ownersScanned).toBe(200);
  });

  test('usersに行の無い保有者だけの物理削除を、昇順に1保有者ずつ呼ぶ', async () => {
    const orphans = [ownerIdOf(2), ownerIdOf(95), ownerIdOf(150)];
    const { job, eraseCalls } = setup({
      allOwners: ownerIds(200),
      existing: ownerIds(200).filter((id) => !orphans.includes(id)),
    });

    const result = await job.sweep();

    expect(eraseCalls).toEqual(orphans.map((id) => ({ kind: 'user', id })));
    expect(result).toEqual({
      ownersScanned: 200,
      orphanOwners: 3,
      failedOwners: 0,
      filesErased: 3,
      truncated: false,
    });
  });

  test('存在する保有者は、退会済みで物理削除前でも削除の対象にしない', async () => {
    const withdrawn = ownerIdOf(2);
    const { job, eraseCalls } = setup({
      allOwners: [ownerIdOf(1), withdrawn],
      existing: [ownerIdOf(1), withdrawn],
    });

    const result = await job.sweep();

    expect(eraseCalls).toEqual([]);
    expect(result.orphanOwners).toBe(0);
  });

  test('保有者の居ない場合は存在の照会も削除もせず、件数0で終える', async () => {
    const { job, existenceCalls, eraseCalls } = setup({ allOwners: [] });

    const result = await job.sweep();

    expect(existenceCalls).toEqual([]);
    expect(eraseCalls).toEqual([]);
    expect(result).toEqual({
      ownersScanned: 0,
      orphanOwners: 0,
      failedOwners: 0,
      filesErased: 0,
      truncated: false,
    });
  });

  test('1保有者の削除はhasMoreが偽になるまで繰り返し、処理した件数を合計する', async () => {
    const { job, eraseCalls } = setup({
      allOwners: [ownerIdOf(1)],
      erase: (_id, call) =>
        call < 3
          ? { processed: 300, hasMore: true }
          : { processed: 120, hasMore: false },
    });

    const result = await job.sweep();

    expect(eraseCalls).toHaveLength(3);
    expect(result).toMatchObject({
      orphanOwners: 1,
      filesErased: 720,
      truncated: false,
    });
  });

  test('消した件数が1,000件に達したら、次の保有者のeraseOwnedByを呼ばずに打ち切る', async () => {
    const { job, eraseCalls } = setup({
      allOwners: ownerIds(3),
      erase: (id) =>
        id === ownerIdOf(1)
          ? { processed: 1000, hasMore: false }
          : { processed: 1, hasMore: false },
    });

    const result = await job.sweep();

    expect(eraseCalls).toEqual([{ kind: 'user', id: ownerIdOf(1) }]);
    expect(result).toEqual({
      ownersScanned: 3,
      orphanOwners: 1,
      failedOwners: 0,
      filesErased: 1000,
      truncated: true,
    });
  });

  test('1保有者の途中で1,000件に達したら、同じ保有者の次の呼び出しもしない', async () => {
    const { job, eraseCalls } = setup({
      allOwners: ownerIds(2),
      erase: () => ({ processed: 500, hasMore: true }),
    });

    const result = await job.sweep();

    expect(eraseCalls).toHaveLength(2);
    expect(result).toMatchObject({ filesErased: 1000, truncated: true });
  });

  test('達する前の呼び出しで1,000件を超えた分も消えるので、合計は1,000件を超えうる', async () => {
    const { job, eraseCalls } = setup({
      allOwners: ownerIds(2),
      erase: () => ({ processed: 1000, hasMore: true }),
    });

    const result = await job.sweep();

    expect(eraseCalls).toHaveLength(1);
    expect(result.filesErased).toBe(1000);

    const second = setup({
      allOwners: ownerIds(2),
      erase: (_id, call) =>
        call === 1
          ? { processed: 999, hasMore: true }
          : { processed: 1000, hasMore: false },
    });
    const overshoot = await second.job.sweep();

    expect(second.eraseCalls).toHaveLength(2);
    expect(overshoot).toMatchObject({ filesErased: 1999, truncated: true });
  });

  test('保有者ごとの失敗を保有者のIDだけで警告に残して次の保有者へ進み、失敗した保有者は数に入れる', async () => {
    const failure = new Error('R2への接続に失敗しました');
    const { job, eraseCalls } = setup({
      allOwners: ownerIds(3),
      erase: (id) =>
        id === ownerIdOf(2) ? failure : { processed: 4, hasMore: false },
    });

    const result = await job.sweep();

    expect(eraseCalls.map(({ id }) => id)).toEqual(ownerIds(3));
    expect(result).toEqual({
      ownersScanned: 3,
      orphanOwners: 3,
      failedOwners: 1,
      filesErased: 8,
      truncated: false,
    });
    expect(logsOfJob()).toEqual([
      {
        level: 'warning',
        properties: { ownerId: ownerIdOf(2), error: failure },
      },
    ]);
  });

  test('失敗するまでに消した件数は、失敗した保有者の分も合計に残る', async () => {
    const { job } = setup({
      allOwners: ownerIds(1),
      erase: (_id, call) =>
        call === 1 ? { processed: 300, hasMore: true } : new Error('失敗'),
    });

    const result = await job.sweep();

    expect(result).toMatchObject({ failedOwners: 1, filesErased: 300 });
  });

  test('処理が進まないのにhasMoreが真の保有者は、繰り返さずに次の保有者へ進む', async () => {
    const { job, eraseCalls } = setup({
      allOwners: ownerIds(2),
      erase: (id) =>
        id === ownerIdOf(1)
          ? { processed: 0, hasMore: true }
          : { processed: 2, hasMore: false },
    });

    const result = await job.sweep();

    expect(eraseCalls.map(({ id }) => id)).toEqual(ownerIds(2));
    expect(result.filesErased).toBe(2);
  });

  test('保有者のIDの読み取りの失敗はジョブの失敗として投げる', async () => {
    const failure = new Error('D1が使えません');
    const job = new OrphanedFileSweepJob(
      {
        listOwnerIds: () => Promise.reject(failure),
      } as unknown as MediaFiles,
      {} as unknown as ProfileStore,
    );

    const thrown = await job.sweep().catch((error: unknown) => error);

    expect(thrown).toBe(failure);
  });

  test('利用者の存在の照会の失敗はジョブの失敗として投げ、何も削除しない', async () => {
    const failure = new Error('D1が使えません');
    const eraseCalls: OwnerRef[] = [];
    const job = new OrphanedFileSweepJob(
      {
        listOwnerIds: () =>
          Promise.resolve({ ownerIds: [ownerIdOf(1)], next: undefined }),
        eraseOwnedBy: (owner: OwnerRef) => {
          eraseCalls.push(owner);
          return Promise.resolve({ processed: 1, hasMore: false });
        },
      } as unknown as MediaFiles,
      {
        findExistingUserIds: () => Promise.reject(failure),
      } as unknown as ProfileStore,
    );

    const thrown = await job.sweep().catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(eraseCalls).toEqual([]);
  });
});

describe('OrphanedFileSweepJob.run', () => {
  test('件数だけを属性にinfoのログへ残す', async () => {
    const { job } = setup({
      allOwners: ownerIds(3),
      existing: [ownerIdOf(1)],
    });

    await job.run();

    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: {
          ownersScanned: 3,
          orphanOwners: 2,
          failedOwners: 0,
          filesErased: 2,
          truncated: false,
        },
      },
    ]);
  });

  test('保有者ごとの失敗があってもジョブは失敗せず、結果をログに残す', async () => {
    const { job } = setup({
      allOwners: ownerIds(1),
      erase: () => new Error('失敗'),
    });

    await job.run();

    expect(logsOfJob().map(({ level }) => level)).toEqual(['warning', 'info']);
  });
});
