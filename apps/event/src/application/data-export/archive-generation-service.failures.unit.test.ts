import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { LogRecord } from '@logtape/logtape';

import { ArchiveTooLargeError } from '../../../lib/core/data-export/archive-limits.ts';
import {
  ATTEMPTS,
  captureLogs,
  contentOf,
  createHarness,
  DURATION_MS,
  erroringBody,
  EXPORT_ID,
  HANDLE,
  NOW,
  OBJECT_KEY,
  rejectionOf,
} from './archive-generation-service.fixtures.ts';

const logs = captureLogs();

beforeEach(logs.start);
afterEach(logs.stop);

function serviceRecords(): LogRecord[] {
  return logs
    .all()
    .filter(
      ({ category }) =>
        category[1] === 'application' && category[2] === 'data-export',
    );
}

function recordsAt(level: LogRecord['level']): LogRecord[] {
  return serviceRecords().filter((record) => record.level === level);
}

const TOO_LARGE_BYTES = () => Promise.reject(new ArchiveTooLargeError('bytes'));

describe('ArchiveGenerationService.generate: 上限超過', () => {
  test('上限超過ならアップロードを破棄し、通知ありのtoo_largeで失敗にして、リースは解放しない', async () => {
    const harness = createHarness({ openContent: TOO_LARGE_BYTES });

    expect(await harness.generate()).toBe('too_large');
    expect(harness.calls.fail).toStrictEqual([
      { exportId: EXPORT_ID, kind: 'too_large', now: NOW, notify: true },
    ]);
    expect(harness.events).toStrictEqual([
      'claim',
      'collect',
      'beginUpload',
      'recordUpload',
      'upload.abort',
      'terminator.fail',
    ]);
  });

  test('アップロードの破棄に失敗しても、失敗の確定は行う', async () => {
    const harness = createHarness({
      openContent: TOO_LARGE_BYTES,
      uploadAbortError: new Error('R2が使えません'),
    });

    expect(await harness.generate()).toBe('too_large');
    expect(harness.calls.fail).toHaveLength(1);
  });

  test('失敗の確定が既に済んでいれば、finishedを返す', async () => {
    const harness = createHarness({
      openContent: TOO_LARGE_BYTES,
      terminatorResult: 'already_finished',
    });

    expect(await harness.generate()).toBe('finished');
  });

  test('失敗の確定が例外になれば、リースを解放してその例外を投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({
      openContent: TOO_LARGE_BYTES,
      terminatorError: failure,
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.calls.releaseLease).toHaveLength(1);
  });

  test('アップロードの完了の後の上限超過は起きない前提でも、完了の後の失敗は破棄でなくZIPの削除で片付ける', async () => {
    const harness = createHarness({
      markReadyError: new ArchiveTooLargeError('bytes'),
    });

    expect(await harness.generate()).toBe('too_large');
    expect(harness.calls.delete).toStrictEqual([[OBJECT_KEY]]);
    expect(harness.events).not.toContain('upload.abort');
  });
});

describe('ArchiveGenerationService.generate: 一時的な失敗', () => {
  test('ファイルの読み出しの失敗は、アップロードを破棄しリースを解放して、その例外を投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({
      openContent: () => Promise.reject(failure),
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.events).toStrictEqual([
      'claim',
      'collect',
      'beginUpload',
      'recordUpload',
      'upload.abort',
      'releaseLease',
    ]);
    expect(harness.calls.releaseLease).toStrictEqual([
      { id: EXPORT_ID, runToken: harness.runToken() },
    ]);
    expect(harness.calls.fail).toStrictEqual([]);
    expect(harness.calls.notify).toStrictEqual([]);
  });

  test('ファイルの本文の読み出しが途中で失敗しても、同じく破棄・解放して投げる', async () => {
    const failure = new Error('接続が切れました');
    const harness = createHarness({
      openContent: (fileId) =>
        Promise.resolve(contentOf(fileId, erroringBody(failure))),
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.events).toContain('upload.abort');
    expect(harness.events.at(-1)).toBe('releaseLease');
  });

  test('収集の失敗は、アップロードを始めていないため破棄を呼ばず、リースを解放して投げる', async () => {
    const failure = new Error('上流の取得に失敗しました');
    const harness = createHarness({ collectError: failure });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.events).toStrictEqual(['claim', 'collect', 'releaseLease']);
  });

  test('アップロードの破棄に失敗したときは、リースを解放せず(次の実行が破棄し直す)、元の例外を投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({
      openContent: () => Promise.reject(failure),
      uploadAbortError: new Error('R2が使えません'),
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.calls.releaseLease).toStrictEqual([]);
  });

  test('リースの解放に失敗しても、元の例外を投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({
      openContent: () => Promise.reject(failure),
      releaseLeaseError: new Error('解放に失敗しました'),
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
  });

  test('アップロードの完了の後の退会の確かめが失敗したら、ZIPを削除しリースを解放して投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({ existsError: failure });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.calls.delete).toStrictEqual([[OBJECT_KEY]]);
    expect(harness.calls.releaseLease).toHaveLength(1);
    expect(harness.events).not.toContain('upload.abort');
  });

  test('完了の記録が例外になったら、ZIPを削除しリースを解放して投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({ markReadyError: failure });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.calls.delete).toStrictEqual([[OBJECT_KEY]]);
    expect(harness.calls.releaseLease).toHaveLength(1);
  });

  test('退会の確かめでZIPを削除した後に失敗の確定が例外になっても、完了済みのアップロードを破棄せず、リースを解放して投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({
      accountExists: false,
      terminatorError: failure,
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.calls.delete).toStrictEqual([[OBJECT_KEY]]);
    expect(harness.events).not.toContain('upload.abort');
    expect(harness.calls.releaseLease).toHaveLength(1);
  });

  test('ZIPの削除にも失敗したときは、リースを解放せずに元の例外を投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({
      markReadyError: failure,
      storageDeleteError: new Error('R2が使えません'),
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.calls.releaseLease).toStrictEqual([]);
  });
});

describe('ArchiveGenerationService.generate: ログ', () => {
  test('完了のinfoのログに、要求のID・バイト数・項目数・所要時間・試行回数を記録する', async () => {
    const harness = createHarness();

    await harness.generate();

    const completed = recordsAt('info');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.properties).toMatchObject({
      exportId: EXPORT_ID,
      outcome: 'ready',
      byteSize: harness.zipBytes(),
      entryCount: Object.keys(harness.zipEntries()).length,
      durationMs: DURATION_MS,
      attempts: ATTEMPTS,
    });
  });

  test('上限超過の失敗のinfoのログに、同じ属性と超えた上限を記録する', async () => {
    const harness = createHarness({
      openContent: () => Promise.reject(new ArchiveTooLargeError('entries')),
    });

    await harness.generate();

    const failed = recordsAt('info');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.properties).toMatchObject({
      exportId: EXPORT_ID,
      outcome: 'too_large',
      limit: 'entries',
      byteSize: 0,
      entryCount: 0,
      durationMs: DURATION_MS,
      attempts: ATTEMPTS,
    });
  });

  test('途中まで格納した後の失敗のログには、そこまでのバイト数と項目数を記録する', async () => {
    const harness = createHarness({
      openContent: (fileId) =>
        fileId === 'F-SHOT'
          ? Promise.reject(new ArchiveTooLargeError('bytes'))
          : Promise.resolve(contentOf(fileId)),
    });

    await harness.generate();

    const [failed] = recordsAt('info');
    expect(failed?.properties.entryCount).toBe(2);
    expect(failed?.properties.byteSize).toBeGreaterThan(0);
  });

  test('退会による中止のinfoのログに、同じ属性を記録する', async () => {
    const harness = createHarness({ snapshot: undefined });

    await harness.generate();

    const canceled = recordsAt('info');
    expect(canceled).toHaveLength(1);
    expect(canceled[0]?.properties).toMatchObject({
      exportId: EXPORT_ID,
      outcome: 'canceled',
      byteSize: 0,
      entryCount: 0,
      durationMs: DURATION_MS,
      attempts: ATTEMPTS,
    });
  });

  test('一時的な失敗のwarningのログに、要求のID・所要時間・試行回数・例外の名前を記録する', async () => {
    const harness = createHarness({
      openContent: () => Promise.reject(new TypeError('接続できません')),
    });

    await rejectionOf(harness.generate());

    const warned = recordsAt('warning');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.properties).toMatchObject({
      exportId: EXPORT_ID,
      outcome: 'retry',
      durationMs: DURATION_MS,
      attempts: ATTEMPTS,
      errorName: 'TypeError',
    });
  });

  test('一時的な失敗では、完了・失敗のinfoのログを出さない', async () => {
    const harness = createHarness({
      openContent: () => Promise.reject(new Error('失敗')),
    });

    await rejectionOf(harness.generate());

    expect(recordsAt('info')).toStrictEqual([]);
  });

  test('ログにメールアドレス・ハンドル・ニックネーム・ファイル名・例外のメッセージを含めない', async () => {
    const failing = createHarness({
      openContent: () =>
        Promise.reject(new Error('user@example.com のファイルが壊れています')),
    });
    const succeeding = createHarness();

    await rejectionOf(failing.generate());
    await succeeding.generate();

    const text = JSON.stringify(serviceRecords());
    for (const secret of [
      'user@example.com',
      HANDLE,
      'ユーザー',
      '.png',
      '.zip',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
