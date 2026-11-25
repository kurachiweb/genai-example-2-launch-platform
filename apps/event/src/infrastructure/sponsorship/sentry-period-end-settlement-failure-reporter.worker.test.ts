import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { LogObject } from '../../../lib/core/logging/log-record.ts';
import {
  recordSponsorshipEvents,
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from '../../../lib/workers/sponsorship/testing/observability-recording.ts';
import { SentryPeriodEndSettlementFailureReporter } from './sentry-period-end-settlement-failure-reporter.ts';

const SPONSORSHIP_ID = '01JD0SP0NS0000000000000001';

const FAILED_MESSAGE = 'スポンサー広告の掲載の終わりの精算に失敗しました';

let logs: LogObject[] = [];
let events: Event[] = [];

beforeEach(() => {
  resetSponsorshipObservability();
  logs = recordSponsorshipLogs('event');
  events = recordSponsorshipEvents();
});

afterEach(() => {
  resetSponsorshipObservability();
});

describe('SentryPeriodEndSettlementFailureReporter', () => {
  test('精算の例外を申込のIDのタグ付きでエラートラッキングへ送り、エラーのログに残す', () => {
    const error = new Error('D1の一括の書き込みに失敗した');

    new SentryPeriodEndSettlementFailureReporter().report({
      sponsorshipId: SPONSORSHIP_ID,
      error,
    });

    const [event, ...otherEvents] = events;
    expect(otherEvents).toEqual([]);
    expect(event?.exception?.values?.[0]).toMatchObject({
      type: 'Error',
      value: 'D1の一括の書き込みに失敗した',
    });
    expect(event?.tags).toStrictEqual({
      message_type: 'sponsorship.settle-period-end',
      sponsorship_id: SPONSORSHIP_ID,
    });
    expect(
      logs.filter(({ category }) => category === 'event.sponsorship'),
    ).toMatchObject([
      {
        level: 'error',
        message: FAILED_MESSAGE,
        sponsorshipId: SPONSORSHIP_ID,
      },
    ]);
  });

  test('識別子の形でない申込のIDはタグとログに入れない', () => {
    new SentryPeriodEndSettlementFailureReporter().report({
      sponsorshipId: 'owner@mail.example',
      error: new Error('失敗した'),
    });

    expect(events[0]?.tags).toMatchObject({ sponsorship_id: 'unknown' });
    expect(JSON.stringify(logs)).not.toContain('owner@mail.example');
  });
});
