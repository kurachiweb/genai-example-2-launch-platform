import { describe, expect, test } from 'bun:test';

import { DATA_EXPORT_FAILURE_KINDS } from '../../../../common-lib/data-export/data-export-rules.ts';
import {
  DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
  DATA_EXPORT_ARCHIVE_READY_EMAIL,
  DATA_EXPORT_EMAIL_KINDS,
} from './data-export.ts';

const READY_FIELDS = {
  nickname: '山田',
  requestedAt: '2026-11-20T07:40:00.000Z',
  expiresAt: '2026-11-27T07:44:00.000Z',
  pageUrl: 'https://client.example/settings/export',
};

const FAILED_FIELDS = {
  nickname: '山田',
  requestedAt: '2026-11-20T07:40:00.000Z',
  reason: 'error' as const,
  pageUrl: 'https://client.example/settings/export',
  contactUrl: 'https://client.example/contact',
};

function readyWith(key: string, value: unknown): unknown {
  return { ...READY_FIELDS, [key]: value };
}

function failedWith(key: string, value: unknown): unknown {
  return { ...FAILED_FIELDS, [key]: value };
}

function acceptsReady(input: unknown): boolean {
  return DATA_EXPORT_ARCHIVE_READY_EMAIL.inputSchema.safeParse(input).success;
}

function acceptsFailed(input: unknown): boolean {
  return DATA_EXPORT_ARCHIVE_FAILED_EMAIL.inputSchema.safeParse(input).success;
}

const INVALID_TEXTS = ['', undefined, null, 1];

const INVALID_URLS = [
  '',
  'http://client.example/settings/export',
  'javascript:alert(1)',
  '/settings/export',
  undefined,
];

const INVALID_DATE_TIMES = [
  '',
  '2026-11-20',
  '2026-11-20T07:40:00',
  'yesterday',
  undefined,
  null,
  1,
];

describe('メール種別data-export.archive-ready', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(DATA_EXPORT_ARCHIVE_READY_EMAIL.name).toBe(
      'data-export.archive-ready',
    );
    expect(DATA_EXPORT_ARCHIVE_READY_EMAIL.category).toBe('transactional');
    expect(Object.isFrozen(DATA_EXPORT_ARCHIVE_READY_EMAIL)).toBe(true);
  });

  test('ニックネーム・要求日時・有効期限・ダウンロードページのURLを受け付け、他の項目を取り除く', () => {
    const result = DATA_EXPORT_ARCHIVE_READY_EMAIL.inputSchema.safeParse({
      ...READY_FIELDS,
      to: 'someone@mail.example',
      downloadUrl:
        'https://client.example/_bff/exports/01JD0PR0D0000000000000000A',
    });

    expect(result).toEqual({ success: true, data: READY_FIELDS });
  });

  test('ローカル環境のダウンロードページのURLをhttp://localhostで受け付ける', () => {
    expect(
      acceptsReady(
        readyWith('pageUrl', 'http://localhost:3000/settings/export'),
      ),
    ).toBe(true);
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first =
      DATA_EXPORT_ARCHIVE_READY_EMAIL.inputSchema.parse(READY_FIELDS);

    expect(DATA_EXPORT_ARCHIVE_READY_EMAIL.inputSchema.parse(first)).toEqual(
      first,
    );
  });

  test('ニックネームが空・欠落・文字列以外なら拒否する', () => {
    for (const value of INVALID_TEXTS) {
      expect(acceptsReady(readyWith('nickname', value))).toBe(false);
    }
  });

  test.each(['requestedAt', 'expiresAt'])(
    'ISO 8601の日時でない%sを拒否する',
    (key) => {
      for (const value of INVALID_DATE_TIMES) {
        expect(acceptsReady(readyWith(key, value))).toBe(false);
      }
    },
  );

  test.each(INVALID_URLS)(
    'https:かhttp://localhostで始まらないダウンロードページのURL%pを拒否する',
    (url) => {
      expect(acceptsReady(readyWith('pageUrl', url))).toBe(false);
    },
  );
});

describe('メール種別data-export.archive-failed', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(DATA_EXPORT_ARCHIVE_FAILED_EMAIL.name).toBe(
      'data-export.archive-failed',
    );
    expect(DATA_EXPORT_ARCHIVE_FAILED_EMAIL.category).toBe('transactional');
    expect(Object.isFrozen(DATA_EXPORT_ARCHIVE_FAILED_EMAIL)).toBe(true);
  });

  test('ニックネーム・要求日時・失敗の種類・ダウンロードページと問い合わせのURLを受け付け、他の項目を取り除く', () => {
    const result = DATA_EXPORT_ARCHIVE_FAILED_EMAIL.inputSchema.safeParse({
      ...FAILED_FIELDS,
      to: 'someone@mail.example',
      errorMessage: 'ZIPの生成に失敗しました',
    });

    expect(result).toEqual({ success: true, data: FAILED_FIELDS });
  });

  test('失敗の種類の一覧の値だけを受け付ける', () => {
    for (const reason of DATA_EXPORT_FAILURE_KINDS) {
      expect(acceptsFailed(failedWith('reason', reason))).toBe(true);
    }
    for (const reason of ['ready', 'expired', 'failed', '', undefined, null]) {
      expect(acceptsFailed(failedWith('reason', reason))).toBe(false);
    }
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first =
      DATA_EXPORT_ARCHIVE_FAILED_EMAIL.inputSchema.parse(FAILED_FIELDS);

    expect(DATA_EXPORT_ARCHIVE_FAILED_EMAIL.inputSchema.parse(first)).toEqual(
      first,
    );
  });

  test('ニックネームが空・欠落・文字列以外なら拒否する', () => {
    for (const value of INVALID_TEXTS) {
      expect(acceptsFailed(failedWith('nickname', value))).toBe(false);
    }
  });

  test('ISO 8601の日時でない要求日時を拒否する', () => {
    for (const value of INVALID_DATE_TIMES) {
      expect(acceptsFailed(failedWith('requestedAt', value))).toBe(false);
    }
  });

  test.each(['pageUrl', 'contactUrl'])(
    'https:かhttp://localhostで始まらない%sを拒否する',
    (key) => {
      for (const url of INVALID_URLS) {
        expect(acceptsFailed(failedWith(key, url))).toBe(false);
      }
    },
  );
});

describe('DATA_EXPORT_EMAIL_KINDS', () => {
  test('完了と失敗の2種をこの順で凍結して持つ', () => {
    expect(DATA_EXPORT_EMAIL_KINDS).toEqual([
      DATA_EXPORT_ARCHIVE_READY_EMAIL,
      DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
    ]);
    expect(Object.isFrozen(DATA_EXPORT_EMAIL_KINDS)).toBe(true);
  });
});
