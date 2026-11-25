import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  captureLogs,
  createHarness,
  EXPORT_ID,
  FINISHED_AT,
  HANDLE,
  LEASE_MS,
  NOW,
  OBJECT_KEY,
  recordOf,
  rejectionOf,
  REQUESTED_AT,
  SEVEN_DAYS_MS,
  snapshotOf,
  UPLOAD_ID,
  USER_ID,
  ZIP_FILE_NAME,
} from './archive-generation-service.fixtures.ts';

const logs = captureLogs();
const decoder = new TextDecoder();

beforeEach(logs.start);
afterEach(logs.stop);

describe('ArchiveGenerationService.generate: リースの取得', () => {
  test('実行の印と、今から1,200秒後のリースの期限でclaimする', async () => {
    const harness = createHarness();

    await harness.generate();

    expect(harness.calls.claim).toHaveLength(1);
    const [claim] = harness.calls.claim;
    expect(claim?.id).toBe(EXPORT_ID);
    expect(claim?.now).toEqual(NOW);
    expect(claim?.leaseUntil).toEqual(new Date(NOW.getTime() + LEASE_MS));
    expect(harness.runToken().length).toBeGreaterThan(0);
  });

  test('実行のたびに別の実行の印を使う', async () => {
    const first = createHarness();
    const second = createHarness();

    await first.generate();
    await second.generate();

    expect(first.runToken()).not.toBe(second.runToken());
  });

  test('他の実行のリースが有効(busy)なら、何もせずbusyを返す', async () => {
    const harness = createHarness({ claim: { kind: 'busy' } });

    expect(await harness.generate()).toBe('busy');
    expect(harness.events).toStrictEqual(['claim']);
  });

  test('完了・期限切れ・失敗の要求(finished)は、何もせずfinishedを返す', async () => {
    const harness = createHarness({ claim: { kind: 'finished' } });

    expect(await harness.generate()).toBe('finished');
    expect(harness.events).toStrictEqual(['claim']);
  });

  test('記録が無い要求(not_found)は、何もせずfinishedを返す', async () => {
    const harness = createHarness({ claim: { kind: 'not_found' } });

    expect(await harness.generate()).toBe('finished');
    expect(harness.events).toStrictEqual(['claim']);
  });

  test('claimの失敗はそのまま投げ、他の操作をしない', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({ claimError: failure });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.events).toStrictEqual(['claim']);
  });
});

describe('ArchiveGenerationService.generate: 前の実行の未完了のアップロード', () => {
  test('前の実行のアップロードの記録があれば、収集の前にそのアップロードを破棄する', async () => {
    const harness = createHarness({
      claim: {
        kind: 'claimed',
        record: recordOf({ uploadId: 'UPLOAD-OLD', objectKey: OBJECT_KEY }),
      },
    });

    await harness.generate();

    expect(harness.calls.abortUpload).toStrictEqual([
      [OBJECT_KEY, 'UPLOAD-OLD'],
    ]);
    expect(harness.events.indexOf('storage.abortUpload')).toBeLessThan(
      harness.events.indexOf('collect'),
    );
  });

  test('アップロードの記録が無ければ、破棄を呼ばない', async () => {
    const harness = createHarness();

    await harness.generate();

    expect(harness.calls.abortUpload).toStrictEqual([]);
  });

  test('アップロードIDだけでオブジェクトのキーが無い記録は、破棄を呼ばない', async () => {
    const harness = createHarness({
      claim: {
        kind: 'claimed',
        record: recordOf({ uploadId: 'UPLOAD-OLD', objectKey: null }),
      },
    });

    await harness.generate();

    expect(harness.calls.abortUpload).toStrictEqual([]);
  });

  test('前のアップロードを破棄できなければ、収集せずに例外を投げ、リースを解放する', async () => {
    const failure = new Error('R2が使えません');
    const harness = createHarness({
      claim: {
        kind: 'claimed',
        record: recordOf({ uploadId: 'UPLOAD-OLD', objectKey: OBJECT_KEY }),
      },
      abortUploadError: failure,
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.events).toStrictEqual([
      'claim',
      'storage.abortUpload',
      'releaseLease',
    ]);
  });
});

describe('ArchiveGenerationService.generate: 退会済み', () => {
  test('収集の結果が無ければ、アップロードを始めず、通知なしで失敗にしてcanceledを返す', async () => {
    const harness = createHarness({ snapshot: undefined });

    expect(await harness.generate()).toBe('canceled');
    expect(harness.calls.fail).toStrictEqual([
      { exportId: EXPORT_ID, kind: 'error', now: NOW, notify: false },
    ]);
    expect(harness.events).toStrictEqual([
      'claim',
      'collect',
      'terminator.fail',
    ]);
  });

  test('収集には利用者のID・要求日時・今を渡す', async () => {
    const harness = createHarness({ snapshot: undefined });

    await harness.generate();

    expect(harness.calls.collect).toStrictEqual([[USER_ID, REQUESTED_AT, NOW]]);
  });

  test('失敗の確定が既に済んでいれば、finishedを返す', async () => {
    const harness = createHarness({
      snapshot: undefined,
      terminatorResult: 'already_finished',
    });

    expect(await harness.generate()).toBe('finished');
  });

  test('失敗の確定が例外になれば、リースを解放して例外を投げる', async () => {
    const failure = new Error('D1が使えません');
    const harness = createHarness({
      snapshot: undefined,
      terminatorError: failure,
    });

    expect(await rejectionOf(harness.generate())).toBe(failure);
    expect(harness.calls.releaseLease).toHaveLength(1);
  });

  test('アップロードの完了の後に退会済みと分かれば、ZIPを削除して通知なしで失敗にしてcanceledを返す', async () => {
    const harness = createHarness({ accountExists: false });

    expect(await harness.generate()).toBe('canceled');
    expect(harness.calls.exists).toStrictEqual([USER_ID]);
    expect(harness.calls.delete).toStrictEqual([[OBJECT_KEY]]);
    expect(harness.calls.fail).toStrictEqual([
      { exportId: EXPORT_ID, kind: 'error', now: NOW, notify: false },
    ]);
    expect(
      harness.events.slice(harness.events.indexOf('upload.complete')),
    ).toStrictEqual([
      'upload.complete',
      'exists',
      'storage.delete',
      'terminator.fail',
    ]);
  });

  test('完了の後の退会の確かめで失敗の確定が済んでいれば、ZIPを削除してfinishedを返す', async () => {
    const harness = createHarness({
      accountExists: false,
      terminatorResult: 'already_finished',
    });

    expect(await harness.generate()).toBe('finished');
    expect(harness.calls.delete).toStrictEqual([[OBJECT_KEY]]);
  });
});

describe('ArchiveGenerationService.generate: ZIPの書き出し', () => {
  test('ZIPのファイル名と保存先のキーでアップロードを始め、記録する', async () => {
    const harness = createHarness();

    await harness.generate();

    expect(harness.calls.beginUpload).toStrictEqual([
      { objectKey: OBJECT_KEY, fileName: ZIP_FILE_NAME },
    ]);
    expect(harness.calls.recordUpload).toStrictEqual([
      {
        id: EXPORT_ID,
        runToken: harness.runToken(),
        uploadId: UPLOAD_ID,
        objectKey: OBJECT_KEY,
      },
    ]);
  });

  test('画像と添付を計画の順に読み、その後にJSON・マークダウン・manifest・READMEの順で書く', async () => {
    const harness = createHarness();

    await harness.generate();

    expect(harness.calls.opened).toStrictEqual([
      'F-AVATAR',
      'F-LOGO',
      'F-SHOT',
      'F-ATTACH',
    ]);
    const names = Object.keys(harness.zipEntries());
    expect(names.slice(0, 4)).toStrictEqual([
      'profile/avatar/F-AVATAR.png',
      'products/product-one/logo/F-LOGO.png',
      'products/product-one/screenshots/F-SHOT.png',
      'inquiries/I-1/M-1/F-ATTACH.png',
    ]);
    expect(names.slice(4, 16)).toStrictEqual(
      [
        'account',
        'profile',
        'products',
        'launches',
        'comments',
        'upvotes',
        'ratings',
        'follows',
        'reports',
        'inquiries',
        'sponsorships',
        'payments',
      ].map((kind) => `${kind}.json`),
    );
    expect(names.slice(16)).toStrictEqual([
      'products/product-one/description.md',
      'manifest.json',
      'README.txt',
    ]);
  });

  test('画像の内容はそのまま格納する', async () => {
    const harness = createHarness();

    await harness.generate();

    const entries = harness.zipEntries();
    expect(decoder.decode(entries['profile/avatar/F-AVATAR.png'])).toBe(
      '内容:F-AVATAR',
    );
    expect(decoder.decode(entries['inquiries/I-1/M-1/F-ATTACH.png'])).toBe(
      '内容:F-ATTACH',
    );
  });

  test('読めないファイルは飛ばしてJSONのパスをnullにし、他のファイルは格納する', async () => {
    const harness = createHarness({ unreadableFileIds: ['F-LOGO'] });

    expect(await harness.generate()).toBe('ready');

    const entries = harness.zipEntries();
    expect(Object.keys(entries)).not.toContain(
      'products/product-one/logo/F-LOGO.png',
    );
    expect(Object.keys(entries)).toContain(
      'products/product-one/screenshots/F-SHOT.png',
    );
    const products = JSON.parse(decoder.decode(entries['products.json'])) as {
      logoPath: string | null;
      screenshots: { path: string | null }[];
    }[];
    expect(products[0]?.logoPath).toBeNull();
    expect(products[0]?.screenshots[0]?.path).toBe(
      'products/product-one/screenshots/F-SHOT.png',
    );
  });

  test('読めたファイルのJSONのパスは、格納したZIP内のパスと一致する', async () => {
    const harness = createHarness();

    await harness.generate();

    const entries = harness.zipEntries();
    const products = JSON.parse(decoder.decode(entries['products.json'])) as {
      logoPath: string | null;
    }[];
    expect(products[0]?.logoPath).toBe('products/product-one/logo/F-LOGO.png');
    expect(Object.keys(entries)).toContain(products[0]?.logoPath ?? '');
  });

  test('全ての項目の更新日時に、リースの起点のnowを書く(fflateはローカルの成分で書くため、UTCで動く実行環境が前提)', async () => {
    const harness = createHarness();

    await harness.generate();

    const timestamps = harness.zipTimestamps();
    expect(timestamps.length).toBeGreaterThan(0);
    for (const timestamp of timestamps) {
      expect(timestamp).toMatchObject({
        year: NOW.getFullYear(),
        month: NOW.getMonth() + 1,
        day: NOW.getDate(),
        hour: NOW.getHours(),
        minute: NOW.getMinutes(),
        second: NOW.getSeconds(),
      });
    }
  });

  test('記録の無いファイルはスナップショットに含まれず、読み出しも行わない', async () => {
    const withoutAvatar = snapshotOf();
    const files = new Map(withoutAvatar.files);
    files.delete('F-AVATAR');
    const harness = createHarness({ snapshot: { ...withoutAvatar, files } });

    await harness.generate();

    expect(harness.calls.opened).not.toContain('F-AVATAR');
  });

  test('アップロードの記録が更新されなければ、アップロードを破棄してsupersededを返し、ファイルを読まない', async () => {
    const harness = createHarness({ recordUploadResult: false });

    expect(await harness.generate()).toBe('superseded');
    expect(harness.events).toStrictEqual([
      'claim',
      'collect',
      'beginUpload',
      'recordUpload',
      'upload.abort',
    ]);
    expect(harness.calls.opened).toStrictEqual([]);
  });
});

describe('ArchiveGenerationService.generate: 完了', () => {
  test('完了の記録にZIPのファイル名・バイト数・完了日時・7日後の有効期限を渡し、通知してreadyを返す', async () => {
    const harness = createHarness();

    expect(await harness.generate()).toBe('ready');

    expect(harness.calls.markReady).toStrictEqual([
      {
        id: EXPORT_ID,
        runToken: harness.runToken(),
        fileName: ZIP_FILE_NAME,
        byteSize: harness.zipBytes(),
        completedAt: FINISHED_AT,
        expiresAt: new Date(FINISHED_AT.getTime() + SEVEN_DAYS_MS),
      },
    ]);
    expect(harness.calls.notify).toStrictEqual([EXPORT_ID]);
  });

  test('アップロードの完了、退会の確かめ、完了の記録、通知の順に進める', async () => {
    const harness = createHarness();

    await harness.generate();

    expect(
      harness.events.slice(harness.events.indexOf('upload.complete')),
    ).toStrictEqual(['upload.complete', 'exists', 'markReady', 'notify']);
  });

  test('完了の記録が実行の印の不一致で更新されなければ、ZIPを削除し、通知せずにsupersededを返す', async () => {
    const harness = createHarness({ markReadyResult: false });

    expect(await harness.generate()).toBe('superseded');
    expect(harness.calls.delete).toStrictEqual([[OBJECT_KEY]]);
    expect(harness.calls.notify).toStrictEqual([]);
    expect(harness.calls.releaseLease).toStrictEqual([]);
  });

  test('通知の依頼が失敗しても、完了を覆さずreadyを返し、警告のログを残す', async () => {
    const harness = createHarness({
      notifyError: new Error('メールが使えません'),
    });

    expect(await harness.generate()).toBe('ready');
    expect(harness.calls.delete).toStrictEqual([]);
    expect(harness.calls.releaseLease).toStrictEqual([]);
    expect(logs.all().some(({ level }) => level === 'warning')).toBe(true);
  });

  test('ハンドルはZIPのファイル名にだけ使い、完了の記録以外へ渡さない', async () => {
    const harness = createHarness();

    await harness.generate();

    expect(JSON.stringify(logs.all())).not.toContain(HANDLE);
  });
});
