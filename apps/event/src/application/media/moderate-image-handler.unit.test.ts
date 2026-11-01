import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import {
  assertRetryPolicy,
  decideOnFailure,
} from '../../../lib/core/messaging/retry-policy.ts';
import {
  clearCapturedLogs,
  CONFIG,
  createHarness,
  DURATION_MS,
  FILE_ID,
  handlerLogs,
  type HarnessOptions,
  metaOf,
  OBJECT_KEY,
  ORIGINAL_BYTES,
  ORIGINAL_FILE_NAME,
  portsOf,
  recordsOf,
  RENDERED_IMAGE,
  resultLog,
  startLogCapture,
  stopLogCapture,
  textBytes,
  viewOf,
} from './moderate-image-handler.fixtures.ts';
import {
  ImageModerationRetryError,
  MODERATION_RETRY_POLICY,
} from './moderate-image-handler.ts';
import { planModerationImage } from './moderation-image-plan.ts';
import type { ModerationOutcome } from './ports.ts';

beforeAll(startLogCapture);
afterAll(stopLogCapture);
beforeEach(clearCapturedLogs);

const BODY = { fileId: FILE_ID };

const SVG_WITH_SCRIPT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>';

const CLEAN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>';

const run = async (options: HarnessOptions = {}, attempts = 1) => {
  const harness = createHarness(options);
  const result = await harness.handler.handle(BODY, metaOf(attempts));
  return { ...harness, result };
};

const transient = (
  reason: Extract<ModerationOutcome, { kind: 'transient' }>['reason'],
): ModerationOutcome => ({ kind: 'transient', reason });

describe('MODERATION_RETRY_POLICY', () => {
  test('最大5回・60秒起点・上限1,800秒で、Queuesの再配信の回数に収まる', () => {
    expect(MODERATION_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 60,
      maxDelaySeconds: 1800,
    });
    expect(() => {
      assertRetryPolicy(MODERATION_RETRY_POLICY);
    }).not.toThrow();
  });

  test('60・120・240・480秒の間隔で再試行し、5回目は再試行しない', () => {
    const delays = [1, 2, 3, 4].map((attempts) =>
      decideOnFailure(MODERATION_RETRY_POLICY, attempts),
    );

    expect(delays).toEqual(
      [60, 120, 240, 480].map((delaySeconds) => ({
        kind: 'retry',
        delaySeconds,
      })),
    );
    expect(decideOnFailure(MODERATION_RETRY_POLICY, 5)).toEqual({
      kind: 'dead-letter',
    });
  });
});

describe('ModerateImageHandler 判定の対象外', () => {
  test.each<[string, MediaFileView | undefined]>([
    ['記録が無い', undefined],
    ['保存が完了していない', viewOf({ stored: false })],
    ['論理削除済み', viewOf({ deletedAt: new Date('2030-01-15T11:59:50Z') })],
    ['削除待ち', viewOf({ eraseRequested: true })],
    [
      'ファイル用の用途',
      viewOf({
        storage: 'files',
        location: 'files',
        contentType: 'application/pdf',
        moderationStatus: 'not_required',
      }),
    ],
  ])('%sなら判定も保存先の調整もせずに完了する', async (_, file) => {
    const { result, calls, incidents } = await run({ file });

    expect(result).toEqual({ kind: 'done' });
    expect(portsOf(calls)).toEqual(['findViews']);
    expect(calls[0]).toEqual({ port: 'findViews', ids: [FILE_ID] });
    expect(incidents).toEqual([]);
    expect(resultLog().properties).toMatchObject({
      result: 'skipped',
      fileId: FILE_ID,
    });
  });
});

describe('ModerateImageHandler 判定済みの依頼', () => {
  test.each<[string, MediaFileView]>([
    ['問題なしの判定済み(重複の依頼)', viewOf({ moderationStatus: 'passed' })],
    [
      '不適切の判定済み(重複の依頼)',
      viewOf({
        moderationStatus: 'flagged',
        quarantineReasons: ['auto'],
        quarantined: true,
        location: 'quarantine',
      }),
    ],
    [
      '管理者が自動判定の隔離を解除した後',
      viewOf({
        moderationStatus: 'flagged',
        quarantineReasons: [],
        quarantined: false,
        location: 'quarantine',
      }),
    ],
    ['判定の不要な画像', viewOf({ moderationStatus: 'not_required' })],
  ])('%sは判定し直さず保存先だけをそろえる', async (_, file) => {
    const { result, calls, incidents } = await run({ file, moved: 1 });

    expect(result).toEqual({ kind: 'done' });
    expect(portsOf(calls)).toEqual(['findViews', 'reconcile']);
    expect(calls[1]).toEqual({ port: 'reconcile', fileIds: [FILE_ID] });
    expect(incidents).toEqual([]);
    expect(resultLog().properties).toMatchObject({
      result: 'already-moderated',
      moved: 1,
    });
  });
});

describe('ModerateImageHandler 原本の読み出し', () => {
  test('現在の保存先に原本が無ければ他方のバケットから読んで判定する', async () => {
    const { calls } = await run({
      objects: { quarantine: ORIGINAL_BYTES },
    });

    expect(calls.slice(1, 3)).toEqual([
      { port: 'get', location: 'images', key: OBJECT_KEY },
      { port: 'get', location: 'quarantine', key: OBJECT_KEY },
    ]);
    expect(portsOf(calls)).toContain('detect');
  });

  test('隔離バケットにある画像は隔離バケットから先に読む', async () => {
    const { calls } = await run({
      file: viewOf({ location: 'quarantine' }),
      objects: { quarantine: ORIGINAL_BYTES },
    });

    expect(calls[1]).toEqual({
      port: 'get',
      location: 'quarantine',
      key: OBJECT_KEY,
    });
    expect(portsOf(calls).filter((port) => port === 'get')).toHaveLength(1);
  });

  test('どちらのバケットにも原本が無ければ記録せずに完了する', async () => {
    const { result, calls } = await run({ objects: {} });

    expect(result).toEqual({ kind: 'done' });
    expect(portsOf(calls)).toEqual(['findViews', 'get', 'get']);
    expect(resultLog()).toMatchObject({
      level: 'warning',
      properties: { result: 'original-missing' },
    });
  });
});

describe('ModerateImageHandler SVGの検査', () => {
  test('許可リストの違反は判定サービスへ送らず、違反の種類と名前を付けて不適切と記録してから保存先をそろえる', async () => {
    const { result, calls, incidents } = await run({
      file: viewOf({ contentType: 'image/svg+xml', width: 10, height: 10 }),
      objects: { images: textBytes(SVG_WITH_SCRIPT) },
    });

    expect(result).toEqual({ kind: 'done' });
    expect(portsOf(calls)).toEqual([
      'findViews',
      'get',
      'recordModeration',
      'reconcile',
    ]);
    expect(recordsOf(calls)).toEqual([
      {
        verdict: 'flagged',
        findings: [
          { source: 'svg', violation: 'disallowed-element', target: 'script' },
        ],
      },
    ]);
    expect(incidents).toEqual([]);
    expect(resultLog().properties).toMatchObject({
      result: 'flagged',
      findings: 1,
    });
  });

  test('違反の無い寸法の無いSVGは640×640として判定用画像を作り、判定サービスで判定する', async () => {
    const original = textBytes(CLEAN_SVG);
    const { calls } = await run({
      file: viewOf({
        contentType: 'image/svg+xml',
        width: null,
        height: null,
        byteSize: original.byteLength,
      }),
      objects: { images: original },
    });

    expect(portsOf(calls)).toEqual([
      'findViews',
      'get',
      'render',
      'detect',
      'recordModeration',
      'reconcile',
    ]);
    expect(calls[2]).toEqual({
      port: 'render',
      original,
      plan: planModerationImage({
        type: 'image/svg+xml',
        width: 640,
        height: 640,
        byteSize: original.byteLength,
      }),
    });
  });
});

describe('ModerateImageHandler 判定用画像と判定サービス', () => {
  test('原本の寸法から計画した判定用画像を作り、その画像と閾値だけを判定サービスへ渡す', async () => {
    const { calls } = await run();

    expect(calls[2]).toEqual({
      port: 'render',
      original: ORIGINAL_BYTES,
      plan: planModerationImage({
        type: 'image/png',
        width: 1280,
        height: 720,
        byteSize: ORIGINAL_BYTES.byteLength,
      }),
    });
    expect(calls[3]).toEqual({
      port: 'detect',
      image: RENDERED_IMAGE,
      minConfidence: CONFIG.minConfidence,
    });
  });

  test('問題が無ければ問題なしと記録してから保存先をそろえる', async () => {
    const { result, calls, incidents } = await run();

    expect(result).toEqual({ kind: 'done' });
    expect(portsOf(calls)).toEqual([
      'findViews',
      'get',
      'render',
      'detect',
      'recordModeration',
      'reconcile',
    ]);
    expect(recordsOf(calls)).toEqual([{ verdict: 'passed' }]);
    expect(incidents).toEqual([]);
    expect(resultLog()).toMatchObject({
      level: 'info',
      properties: {
        result: 'passed',
        fileId: FILE_ID,
        attempts: 1,
        durationMs: DURATION_MS,
        planKind: 'resize',
        recorded: true,
        moved: 0,
      },
    });
  });

  test('設定のカテゴリで閾値以上のラベルは、カテゴリ・ラベル・信頼度を付けて不適切と記録してから保存先をそろえる', async () => {
    const { calls } = await run({
      outcome: {
        kind: 'labels',
        labels: [
          {
            name: 'Graphic Violence',
            parentName: 'Violence',
            confidence: 88.5,
            taxonomyLevel: 2,
          },
          {
            name: 'Violence',
            parentName: '',
            confidence: 88.5,
            taxonomyLevel: 1,
          },
          {
            name: 'Alcohol',
            parentName: '',
            confidence: 99,
            taxonomyLevel: 1,
          },
        ],
      },
    });

    expect(portsOf(calls).slice(-2)).toEqual(['recordModeration', 'reconcile']);
    expect(recordsOf(calls)).toEqual([
      {
        verdict: 'flagged',
        findings: [
          {
            source: 'labels',
            category: 'Violence',
            label: 'Graphic Violence',
            confidence: 88.5,
          },
          {
            source: 'labels',
            category: 'Violence',
            label: 'Violence',
            confidence: 88.5,
          },
        ],
      },
    ]);
  });

  test('復号できない画像は判定サービスへ送らず、恒久的な失敗として不適切と記録してから保存先をそろえる', async () => {
    const { calls, incidents } = await run({
      render: { ok: false, reason: 'undecodable' },
    });

    expect(portsOf(calls)).toEqual([
      'findViews',
      'get',
      'render',
      'recordModeration',
      'reconcile',
    ]);
    expect(recordsOf(calls)).toEqual([
      {
        verdict: 'flagged',
        findings: [{ source: 'unprocessable', reason: 'undecodable' }],
      },
    ]);
    expect(incidents).toEqual([]);
    expect(resultLog()).toMatchObject({
      level: 'warning',
      properties: { result: 'flagged', reason: 'undecodable' },
    });
  });

  test('判定サービスが受け付けない画像は不適切と記録し、運用者へ通知してから保存先をそろえる', async () => {
    const { calls, incidents } = await run({
      outcome: { kind: 'rejected', reason: 'invalid-image' },
    });

    expect(portsOf(calls).slice(-2)).toEqual(['recordModeration', 'reconcile']);
    expect(recordsOf(calls)).toEqual([
      {
        verdict: 'flagged',
        findings: [{ source: 'unprocessable', reason: 'rejected-by-service' }],
      },
    ]);
    expect(incidents).toEqual([
      { kind: 'rejectedByService', fileId: FILE_ID, reason: 'invalid-image' },
    ]);
    expect(resultLog()).toMatchObject({
      level: 'warning',
      properties: { result: 'flagged', reason: 'invalid-image' },
    });
  });

  test('並行した重複配信に先を越されて記録が効かなくても保存先をそろえ、通知を重ねない', async () => {
    const { calls, incidents } = await run({
      outcome: { kind: 'rejected', reason: 'too-large' },
      recorded: false,
    });

    expect(portsOf(calls).slice(-2)).toEqual(['recordModeration', 'reconcile']);
    expect(incidents).toEqual([]);
    expect(resultLog().properties).toMatchObject({ recorded: false });
  });
});

describe('ModerateImageHandler 一時的な失敗', () => {
  test.each([1, 2, 3, 4])(
    '%i回目の試行の一時的な失敗は記録も保存先の調整もせず、再試行の例外を投げる',
    async (attempts) => {
      const harness = createHarness({ outcome: transient('throttled') });

      const error: unknown = await harness.handler
        .handle(BODY, metaOf(attempts))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ImageModerationRetryError);
      expect((error as Error).name).toBe('ImageModerationRetryError');
      expect(portsOf(harness.calls)).toEqual([
        'findViews',
        'get',
        'render',
        'detect',
      ]);
      expect(harness.incidents).toEqual([]);
      expect(resultLog()).toMatchObject({
        level: 'warning',
        properties: { result: 'retrying', attempts, reason: 'throttled' },
      });
    },
  );

  test.each(['throttled', 'service-error', 'timeout', 'network'] as const)(
    '上限の試行の一時的な失敗(%s)は未判定と記録して警告し、保存先を動かさずに完了する',
    async (reason) => {
      const { result, calls, incidents } = await run(
        { outcome: transient(reason) },
        MODERATION_RETRY_POLICY.maxAttempts,
      );

      expect(result).toEqual({ kind: 'done' });
      expect(portsOf(calls)).toEqual([
        'findViews',
        'get',
        'render',
        'detect',
        'recordModeration',
      ]);
      expect(recordsOf(calls)).toEqual([{ verdict: 'undetermined' }]);
      expect(incidents).toEqual([
        { kind: 'undetermined', fileId: FILE_ID, reason },
      ]);
      expect(resultLog()).toMatchObject({
        level: 'warning',
        properties: { result: 'undetermined', reason },
      });
    },
  );

  test('上限の試行で未判定の記録が効かなければ未判定を通知しない', async () => {
    const { incidents } = await run(
      { outcome: transient('timeout'), recorded: false },
      MODERATION_RETRY_POLICY.maxAttempts,
    );

    expect(incidents).toEqual([]);
  });
});

describe('ModerateImageHandler 設定の誤り', () => {
  test('上限未満の試行は通知せずに再試行の例外を投げる', async () => {
    const harness = createHarness({ outcome: transient('misconfigured') });

    const error: unknown = await harness.handler
      .handle(BODY, metaOf(1))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImageModerationRetryError);
    expect(portsOf(harness.calls)).not.toContain('recordModeration');
    expect(harness.incidents).toEqual([]);
  });

  test('上限の試行は未判定と記録し、未判定に加えて設定の誤りを通知する', async () => {
    const { result, calls, incidents } = await run(
      { outcome: transient('misconfigured') },
      MODERATION_RETRY_POLICY.maxAttempts,
    );

    expect(result).toEqual({ kind: 'done' });
    expect(recordsOf(calls)).toEqual([{ verdict: 'undetermined' }]);
    expect(portsOf(calls)).not.toContain('reconcile');
    expect(incidents).toEqual([
      { kind: 'undetermined', fileId: FILE_ID, reason: 'misconfigured' },
      { kind: 'misconfigured', reason: 'misconfigured' },
    ]);
    expect(resultLog()).toMatchObject({
      level: 'error',
      properties: { result: 'undetermined', reason: 'misconfigured' },
    });
  });
});

describe('ModerateImageHandler ログ', () => {
  test('結果のログを1件だけ出し、元のファイル名と画像の内容を含めない', async () => {
    await run();

    expect(handlerLogs()).toHaveLength(1);
    const serialized = JSON.stringify(resultLog());
    expect(serialized).not.toContain(ORIGINAL_FILE_NAME);
    expect(serialized).not.toContain(OBJECT_KEY);
  });
});
