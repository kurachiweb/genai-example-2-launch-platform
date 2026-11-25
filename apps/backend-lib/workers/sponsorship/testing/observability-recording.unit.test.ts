import { captureException, getClient } from '@sentry/cloudflare';
import { afterEach, describe, expect, test } from 'bun:test';

import { getAppLogger } from '../../../core/logging/app-logger.ts';
import {
  recordSponsorshipEvents,
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from './observability-recording.ts';

afterEach(() => {
  resetSponsorshipObservability();
});

describe('recordSponsorshipEvents', () => {
  test('送信の前のイベントを集め、送信の経路へは渡さずに終える', async () => {
    resetSponsorshipObservability();
    const events = recordSponsorshipEvents();

    captureException(new Error('記録の確認'));
    const flushed = await getClient()?.flush();

    expect(
      events.map(({ exception }) => exception?.values?.[0]?.value),
    ).toEqual(['記録の確認']);
    expect(flushed).toBe(true);
  });

  test('解除の後のイベントは集めない', () => {
    resetSponsorshipObservability();
    const events = recordSponsorshipEvents();
    resetSponsorshipObservability();

    captureException(new Error('解除の後'));

    expect(events).toEqual([]);
  });
});

describe('recordSponsorshipLogs', () => {
  test('指定したアプリの名前で設定したログを集める', () => {
    resetSponsorshipObservability();
    const logs = recordSponsorshipLogs('event');

    getAppLogger(['event', 'sponsorship']).info('記録の確認');

    expect(
      logs.map(({ category, message }) => ({ category, message })),
    ).toEqual([{ category: 'event.sponsorship', message: '記録の確認' }]);
  });
});
