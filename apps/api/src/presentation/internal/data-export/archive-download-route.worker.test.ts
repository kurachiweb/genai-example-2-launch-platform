import { resetSync } from '@logtape/logtape';
import { env } from 'cloudflare:workers';
import { afterAll, afterEach, describe, expect, test } from 'vitest';

import {
  INTERNAL_ERROR_RESPONSE,
  NOT_FOUND_RESPONSE,
} from '../../../../lib/core/errors/error-envelope.ts';
import { attachmentDisposition } from '../../../../lib/core/media/file-name.ts';
import {
  expiredColumnsOf,
  failedColumnsOf,
  readyColumnsOf,
  seed,
} from '../../../../lib/workers/data-export/testing/data-export-fixtures.ts';
import {
  downloadArchive as download,
  readReportedIncidents,
  resetReportedIncidents,
} from '../../../../test/support/data-export-download-harness.ts';
import {
  exportIdOf,
  exportRowOf,
  freshExportUser,
  installDataExportGraphQLTest,
  issueUserSession,
} from '../../../../test/support/data-export-graphql-operations.ts';
import { createFailingD1 } from '../../../../test/support/failing-d1.ts';

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

const FILE_NAME = 'launch-stadium-export.zip';
const ZIP_BYTES = new Uint8Array([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0xe3, 0x81, 0xff,
]);
const HOUR_MS = 3_600_000;

const storedKeys: string[] = [];

installDataExportGraphQLTest();

afterEach(async () => {
  await env.FILES_BUCKET.delete(storedKeys.splice(0));
  resetReportedIncidents();
});

afterAll(() => {
  resetSync();
});

const hoursFromNow = (hours: number): Date =>
  new Date(Date.now() + hours * HOUR_MS);

const keyOf = (index: number): string =>
  `data-exports/${exportIdOf(index)}.zip`;

async function storeArchive(
  index: number,
  httpMetadata: R2HTTPMetadata = {
    contentType: 'application/zip',
    contentDisposition: attachmentDisposition(FILE_NAME),
    cacheControl: 'private, no-store',
  },
): Promise<void> {
  storedKeys.push(keyOf(index));
  await env.FILES_BUCKET.put(keyOf(index), ZIP_BYTES, { httpMetadata });
}

function readyRowOf(
  index: number,
  userIndex: number,
  columns: Parameters<typeof exportRowOf>[2] = {},
) {
  return exportRowOf(index, userIndex, {
    ...readyColumnsOf(hoursFromNow(24)),
    objectKey: keyOf(index),
    byteSize: ZIP_BYTES.byteLength,
    ...columns,
  });
}

async function downloadAs(
  userIndex: number,
  exportId: string,
  bindings: Partial<Env> = {},
): Promise<Response> {
  return download(
    exportId,
    { token: await issueUserSession(userIndex) },
    bindings,
  );
}

async function expectIndistinguishableNotFound(
  response: Response,
): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Content-Disposition')).toBeNull();
  expect(response.headers.get('Content-Type')).toMatch(/^application\/json/u);
  expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
}

describe('GET /internal/data-exports/:exportId/archive', () => {
  test('本人の完了したエクスポートを、保存時の形式と添付の指定・バイト数・no-store・nosniffを付けてZIPの本文のまま返す', async () => {
    const user = await freshExportUser();
    await seed([readyRowOf(1, user)]);
    await storeArchive(1);

    const response = await downloadAs(user, exportIdOf(1));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toBe(
      attachmentDisposition(FILE_NAME),
    );
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; /u,
    );
    expect(response.headers.get('Content-Length')).toBe(
      String(ZIP_BYTES.byteLength),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(
      ZIP_BYTES,
    );
    expect(readReportedIncidents()).toStrictEqual([]);
  });

  test('停止中の本人も、自分のデータを受け取れる', async () => {
    const user = await freshExportUser({
      emailVerifiedAt: new Date(),
      status: 'suspended',
      suspendedAt: new Date(),
    });
    await seed([readyRowOf(1, user)]);
    await storeArchive(1);

    const response = await downloadAs(user, exportIdOf(1));

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(
      ZIP_BYTES,
    );
  });

  test('保存時のメタデータが無いオブジェクトも、ZIPの添付として返す', async () => {
    const user = await freshExportUser();
    await seed([readyRowOf(1, user)]);
    await storeArchive(1, {});

    const response = await downloadAs(user, exportIdOf(1));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toBe(
      attachmentDisposition(FILE_NAME),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  describe('未ログイン', () => {
    test.each([
      ['セッションが無い', null],
      ['無効なセッション', 'expired'.padEnd(43, '0')],
    ] as const)(
      '%sなら、記録の有無によらず401と共通のエラー形式で応答する',
      async (_label, token) => {
        const user = await freshExportUser();
        await seed([readyRowOf(1, user)]);
        await storeArchive(1);

        const response = await download(exportIdOf(1), { token });

        expect(response.status).toBe(401);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect((await response.json<ErrorBody>()).error.code).toBe(
          'unauthenticated',
        );
      },
    );

    test('形式の不正なIDでも、404より先に401で応答する', async () => {
      const response = await download('not-an-export-id', { token: null });

      expect(response.status).toBe(401);
    });
  });

  describe('存在の有無が分からないよう、同じ404で応答する', () => {
    test.each([
      ['形式の不正なID', 'not-an-export-id'],
      ['26文字でないID', exportIdOf(1).slice(1)],
      ['小文字のID', exportIdOf(1).toLowerCase()],
      ['存在しないID', exportIdOf(99)],
    ])('%s', async (_label, exportId) => {
      const user = await freshExportUser();
      await seed([readyRowOf(1, user)]);
      await storeArchive(1);

      const response = await downloadAs(user, exportId);

      await expectIndistinguishableNotFound(response);
      expect(readReportedIncidents()).toStrictEqual([]);
    });

    test('他の利用者のエクスポートは、完了していても404にする', async () => {
      const owner = await freshExportUser();
      const other = await freshExportUser();
      await seed([readyRowOf(1, owner)]);
      await storeArchive(1);

      const response = await downloadAs(other, exportIdOf(1));

      await expectIndistinguishableNotFound(response);
      expect(readReportedIncidents()).toStrictEqual([]);
    });

    test('管理者側の呼び出し元は、本人のセッションの形でも404にする', async () => {
      const user = await freshExportUser();
      await seed([readyRowOf(1, user)]);
      await storeArchive(1);

      const response = await download(exportIdOf(1), {
        caller: 'admin',
        token: await issueUserSession(user),
      });

      await expectIndistinguishableNotFound(response);
      expect(readReportedIncidents()).toStrictEqual([]);
    });

    test.each([
      ['作成待ち', { status: 'queued', objectKey: null }],
      ['作成中', { status: 'generating', objectKey: keyOf(1) }],
      ['失敗', { ...failedColumnsOf(), objectKey: null }],
      [
        '有効期限の前の期限切れの状態',
        { ...expiredColumnsOf(), expiresAt: hoursFromNow(24), objectKey: null },
      ],
      [
        '有効期限を過ぎたがまだ削除していない完了',
        { expiresAt: hoursFromNow(-1) },
      ],
    ] as const)(
      '%sの記録は、オブジェクトがあっても404にする',
      async (_label, columns) => {
        const user = await freshExportUser();
        await seed([readyRowOf(1, user, columns)]);
        await storeArchive(1);

        const response = await downloadAs(user, exportIdOf(1));

        await expectIndistinguishableNotFound(response);
        expect(readReportedIncidents()).toStrictEqual([]);
      },
    );

    test('オブジェクトの無い完了の記録は、同じ404にしてarchive-missingを送る', async () => {
      const user = await freshExportUser();
      await seed([readyRowOf(1, user)]);

      const response = await downloadAs(user, exportIdOf(1));

      await expectIndistinguishableNotFound(response);
      expect(readReportedIncidents()).toStrictEqual([
        { kind: 'archive-missing', exportId: exportIdOf(1) },
      ]);
    });
  });

  test('保存先の読み出しに失敗すれば、503と再試行までの秒数を共通のエラー形式で返す', async () => {
    const user = await freshExportUser();
    await seed([readyRowOf(1, user)]);
    await storeArchive(1);
    const failingBucket = {
      get: () => Promise.reject(new Error('差し込んだR2の読み出しの失敗')),
    } as unknown as R2Bucket;

    const response = await downloadAs(user, exportIdOf(1), {
      FILES_BUCKET: failingBucket,
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toMatch(/^[0-9]+$/u);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/u);
    expect((await response.json<ErrorBody>()).error.code).toBe(
      'data_export_archive_unavailable',
    );
    expect(readReportedIncidents()).toStrictEqual([]);
  });

  test('記録の保存先が使えなければ、共通のエラー処理が500の定型の応答にする', async () => {
    const user = await freshExportUser();
    await seed([readyRowOf(1, user)]);
    const token = await issueUserSession(user);

    const response = await download(
      exportIdOf(1),
      { token },
      { DB: createFailingD1() },
    );

    expect(response.status).toBe(INTERNAL_ERROR_RESPONSE.status);
    expect(await response.json()).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
  });

  test('外部経路の要求は、経路を実行せずに定型の404で応答する', async () => {
    const user = await freshExportUser();
    await seed([readyRowOf(1, user)]);
    await storeArchive(1);

    const response = await download(exportIdOf(1), {
      caller: null,
      token: await issueUserSession(user),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
    expect(readReportedIncidents()).toStrictEqual([]);
  });
});
