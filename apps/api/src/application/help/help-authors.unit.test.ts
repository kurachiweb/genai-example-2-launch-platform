import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  AdminDirectory,
  AdminProfileView,
} from '../../../lib/core/admin/ports.ts';
import { DirectoryHelpAuthorLookup } from './help-authors.ts';

const AUTHOR_ID = '01JBX8Y4Z5AUTHOR000000000A';
const OTHER_AUTHOR_ID = '01JBX8Y4Z5AUTHOR000000000B';
const DELETED_AUTHOR_ID = '01JBX8Y4Z5AUTHOR000000000C';
const AVATAR_FILE_ID = '01JBX8Y4Z5AVATAR000000000A';

const PROFILES: readonly AdminProfileView[] = [
  {
    id: AUTHOR_ID,
    nickname: 'サポートの山田',
    title: 'カスタマーサポート',
    avatarFileId: AVATAR_FILE_ID,
  },
  {
    id: OTHER_AUTHOR_ID,
    nickname: '運営の佐藤',
    title: null,
    avatarFileId: null,
  },
];

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

function setup(failure?: Error) {
  const requests: (readonly string[])[] = [];
  const directory: AdminDirectory = {
    findProfiles: (ids) => {
      requests.push(ids);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(
        new Map(
          PROFILES.filter((profile) => ids.includes(profile.id)).map(
            (profile) => [profile.id, profile],
          ),
        ),
      );
    },
  };
  return { lookup: new DirectoryHelpAuthorLookup(directory), requests };
}

describe('DirectoryHelpAuthorLookup.find', () => {
  test('管理者の照会口の結果を管理者のIDを含まない表示用の情報へ写し、削除済みの管理者を結果に含めない', async () => {
    const { lookup, requests } = setup();

    const authors = await lookup.find([
      AUTHOR_ID,
      DELETED_AUTHOR_ID,
      OTHER_AUTHOR_ID,
    ]);

    expect(requests).toEqual([[AUTHOR_ID, DELETED_AUTHOR_ID, OTHER_AUTHOR_ID]]);
    expect([...authors.entries()]).toEqual([
      [
        AUTHOR_ID,
        {
          nickname: 'サポートの山田',
          title: 'カスタマーサポート',
          avatarFileId: AVATAR_FILE_ID,
        },
      ],
      [
        OTHER_AUTHOR_ID,
        { nickname: '運営の佐藤', title: null, avatarFileId: null },
      ],
    ]);
    expect(authors.has(DELETED_AUTHOR_ID)).toBe(false);
  });

  test('重複したIDは1つにまとめて1回で照会する', async () => {
    const { lookup, requests } = setup();

    const authors = await lookup.find([AUTHOR_ID, AUTHOR_ID, OTHER_AUTHOR_ID]);

    expect(requests).toEqual([[AUTHOR_ID, OTHER_AUTHOR_ID]]);
    expect(authors.size).toBe(2);
  });

  test('IDが無ければ照会口を呼ばずに空の結果を返す', async () => {
    const { lookup, requests } = setup();

    const authors = await lookup.find([]);

    expect(requests).toEqual([]);
    expect(authors.size).toBe(0);
  });

  test('照会の例外では全員を削除済みとして空の結果を返し、件数と例外だけを警告のログに残す', async () => {
    const failure = new Error('D1の読み取りに失敗しました');
    const { lookup } = setup(failure);

    const authors = await lookup.find([AUTHOR_ID, OTHER_AUTHOR_ID]);

    expect(authors.size).toBe(0);
    const warnings = records.filter(({ level }) => level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toEqual(['api', 'application', 'help']);
    expect(warnings[0]?.properties).toEqual({ error: failure, count: 2 });
    expect(JSON.stringify(warnings[0]?.message)).not.toContain(AUTHOR_ID);
    expect(records.filter(({ level }) => level !== 'warning')).toEqual([]);
  });

  test('照会が成功すればログを残さない', async () => {
    const { lookup } = setup();

    await lookup.find([AUTHOR_ID]);

    expect(records).toEqual([]);
  });
});
