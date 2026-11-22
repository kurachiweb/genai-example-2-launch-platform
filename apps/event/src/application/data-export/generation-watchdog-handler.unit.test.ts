import { describe, expect, test } from 'bun:test';

import type { DataExportStatus } from '../../../common-lib/data-export/data-export-rules.ts';
import { rejectionOf } from './archive-generation-service.fixtures.ts';
import {
  BODY,
  clockAt,
  EXPORT_ID,
  fakeReporter,
  fakeTerminator,
  NOW,
  recordOf,
  storeFinding,
} from './data-export-handlers.fixtures.ts';
import { GenerationWatchdogHandler } from './generation-watchdog-handler.ts';

function createHarness(
  status: DataExportStatus | undefined,
  terminatorResult: Parameters<typeof fakeTerminator>[0] = 'failed',
) {
  const { terminator, calls } = fakeTerminator(terminatorResult);
  const { reporter, incidents } = fakeReporter();
  const handler = new GenerationWatchdogHandler(
    storeFinding(status === undefined ? undefined : recordOf({ status })),
    terminator,
    reporter,
    clockAt(NOW),
  );
  return { handler, terminated: calls, incidents };
}

describe('GenerationWatchdogHandler', () => {
  test.each(['queued', 'generating'] as const)(
    '%sの要求は、通知ありのerrorで失敗にしてdoneにする',
    async (status) => {
      const harness = createHarness(status);

      expect(await harness.handler.handle(BODY)).toStrictEqual({
        kind: 'done',
      });
      expect(harness.terminated).toStrictEqual([
        { exportId: EXPORT_ID, kind: 'error', now: NOW, notify: true },
      ]);
    },
  );

  test('見張りが失敗を確定したら、watchdogによるgeneration-abandonedを送る', async () => {
    const harness = createHarness('generating');

    await harness.handler.handle(BODY);

    expect(harness.incidents).toStrictEqual([
      { kind: 'generation-abandoned', exportId: EXPORT_ID, by: 'watchdog' },
    ]);
  });

  test('確定の直前に別の処理が終えていたら(already_finished)、送らずにdoneにする', async () => {
    const harness = createHarness('generating', 'already_finished');

    expect(await harness.handler.handle(BODY)).toStrictEqual({
      kind: 'done',
    });
    expect(harness.incidents).toStrictEqual([]);
  });

  test.each(['ready', 'failed', 'expired'] as const)(
    '%sの要求には何もせずdoneにする',
    async (status) => {
      const harness = createHarness(status);

      expect(await harness.handler.handle(BODY)).toStrictEqual({
        kind: 'done',
      });
      expect(harness.terminated).toStrictEqual([]);
      expect(harness.incidents).toStrictEqual([]);
    },
  );

  test('記録が無ければ(退会の削除の後)、何もせずdoneにする', async () => {
    const harness = createHarness(undefined);

    expect(await harness.handler.handle(BODY)).toStrictEqual({
      kind: 'done',
    });
    expect(harness.terminated).toStrictEqual([]);
    expect(harness.incidents).toStrictEqual([]);
  });

  test('失敗の確定の部品が例外を投げたら、そのまま投げて再試行に任せ、送らない', async () => {
    const failure = new Error('D1が使えない');
    const harness = createHarness('generating', failure);

    expect(await rejectionOf(harness.handler.handle(BODY))).toBe(failure);
    expect(harness.incidents).toStrictEqual([]);
  });
});
