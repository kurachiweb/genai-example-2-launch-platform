import { describe, expect, test } from 'bun:test';

import {
  BUSY_DEFER_SECONDS,
  GENERATION_MAX_ATTEMPTS,
  GENERATION_RETRY_POLICY,
} from '../../../lib/core/data-export/data-export-messages.ts';
import { decideOnFailure } from '../../../lib/core/messaging/retry-policy.ts';
import type {
  GenerateArchiveInput,
  GenerationOutcome,
} from './archive-generation-service.ts';
import {
  BODY,
  clockAt,
  EXPORT_ID,
  fakeReporter,
  fakeTerminator,
  metaOf,
  NOW,
} from './data-export-handlers.fixtures.ts';
import { rejectionOf } from './archive-generation-service.fixtures.ts';
import { GenerateArchiveHandler } from './generate-archive-handler.ts';

interface Harness {
  readonly handler: GenerateArchiveHandler;
  readonly generated: GenerateArchiveInput[];
  readonly terminated: ReturnType<typeof fakeTerminator>['calls'];
  readonly incidents: ReturnType<typeof fakeReporter>['incidents'];
}

function createHarness(
  outcome: GenerationOutcome | Error,
  terminatorResult: Parameters<typeof fakeTerminator>[0] = 'failed',
): Harness {
  const generated: GenerateArchiveInput[] = [];
  const { terminator, calls } = fakeTerminator(terminatorResult);
  const { reporter, incidents } = fakeReporter();
  const handler = new GenerateArchiveHandler(
    {
      generate: (input) => {
        generated.push(input);
        return outcome instanceof Error
          ? Promise.reject(outcome)
          : Promise.resolve(outcome);
      },
    },
    terminator,
    reporter,
    clockAt(NOW),
  );
  return { handler, generated, terminated: calls, incidents };
}

describe('GenerateArchiveHandler: 生成の結果', () => {
  test('要求のIDと現在時刻で生成のサービスを呼ぶ', async () => {
    const harness = createHarness('ready');

    await harness.handler.handle(BODY, metaOf(1));

    expect(harness.generated).toStrictEqual([
      { exportId: EXPORT_ID, now: NOW },
    ]);
  });

  test('他の処理が生成中(busy)なら、リースの長さの1200秒だけdeferする', async () => {
    const harness = createHarness('busy');

    expect(await harness.handler.handle(BODY, metaOf(1))).toStrictEqual({
      kind: 'defer',
      delaySeconds: BUSY_DEFER_SECONDS,
    });
    expect(BUSY_DEFER_SECONDS).toBe(1200);
    expect(harness.terminated).toStrictEqual([]);
    expect(harness.incidents).toStrictEqual([]);
  });

  test.each([
    'ready',
    'finished',
    'canceled',
    'too_large',
    'superseded',
  ] as const)(
    '結果が%sならdoneにして、失敗の確定も通知もしない',
    async (outcome) => {
      const harness = createHarness(outcome);

      expect(await harness.handler.handle(BODY, metaOf(3))).toStrictEqual({
        kind: 'done',
      });
      expect(harness.terminated).toStrictEqual([]);
      expect(harness.incidents).toStrictEqual([]);
    },
  );
});

describe('GenerateArchiveHandler: 例外', () => {
  const failure = new Error('R2が一時的に使えない');

  test.each([1, 2])(
    '試行%i回目の例外はそのまま投げ直し、失敗の確定も通知もしない',
    async (attempts) => {
      const harness = createHarness(failure);

      expect(
        await rejectionOf(harness.handler.handle(BODY, metaOf(attempts))),
      ).toBe(failure);
      expect(harness.terminated).toStrictEqual([]);
      expect(harness.incidents).toStrictEqual([]);
    },
  );

  test('3回目の例外は、通知ありのerrorで失敗を確定してdoneにする', async () => {
    const harness = createHarness(failure);

    expect(await harness.handler.handle(BODY, metaOf(3))).toStrictEqual({
      kind: 'done',
    });
    expect(harness.terminated).toStrictEqual([
      { exportId: EXPORT_ID, kind: 'error', now: NOW, notify: true },
    ]);
  });

  test('3回目の例外は、試行の回数と元の例外をgeneration-failedで送る', async () => {
    const harness = createHarness(failure);

    await harness.handler.handle(BODY, metaOf(3));

    expect(harness.incidents).toHaveLength(1);
    const [incident] = harness.incidents;
    expect(incident).toStrictEqual({
      kind: 'generation-failed',
      exportId: EXPORT_ID,
      attempts: 3,
      error: failure,
    });
    expect(incident?.kind === 'generation-failed' && incident.error).toBe(
      failure,
    );
  });

  test('上限を超えた試行の回数でも、失敗を確定する', async () => {
    const harness = createHarness(failure);

    await harness.handler.handle(BODY, metaOf(4));

    expect(harness.terminated).toHaveLength(1);
  });

  test('失敗が既に確定していても(already_finished)、doneにして送る', async () => {
    const harness = createHarness(failure, 'already_finished');

    expect(await harness.handler.handle(BODY, metaOf(3))).toStrictEqual({
      kind: 'done',
    });
    expect(harness.incidents).toHaveLength(1);
  });

  test('3回目に失敗の確定の部品も例外を投げたら、その例外を投げて通知は送らない', async () => {
    const terminatorFailure = new Error('D1が使えない');
    const harness = createHarness(failure, terminatorFailure);

    expect(await rejectionOf(harness.handler.handle(BODY, metaOf(3)))).toBe(
      terminatorFailure,
    );
    expect(harness.incidents).toStrictEqual([]);
  });
});

describe('生成の再試行の方針', () => {
  test('3回・起点60秒・上限600秒で、ハンドラーの上限の試行の回数と一致する', () => {
    expect(GENERATION_RETRY_POLICY).toStrictEqual({
      maxAttempts: 3,
      baseDelaySeconds: 60,
      maxDelaySeconds: 600,
    });
    expect(GENERATION_MAX_ATTEMPTS).toBe(GENERATION_RETRY_POLICY.maxAttempts);
    expect(decideOnFailure(GENERATION_RETRY_POLICY, 2).kind).toBe('retry');
    expect(decideOnFailure(GENERATION_RETRY_POLICY, 3).kind).toBe(
      'dead-letter',
    );
  });
});
