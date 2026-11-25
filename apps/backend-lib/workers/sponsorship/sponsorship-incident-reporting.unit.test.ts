import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { LogObject } from '../../core/logging/log-record.ts';
import type { RefundKind } from '../../core/sponsorship/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  reportSponsorshipIncident,
  type SponsorshipIncidentCode,
} from './sponsorship-incident-reporting.ts';
import {
  recordSponsorshipEvents,
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from './testing/observability-recording.ts';

const SPONSORSHIP_ID = '01JD0SP0NS0RSH1P0000000001';

const ALREADY_SETTLED_MESSAGE =
  '返金できる残額が無いスポンサー広告の返金の依頼を、返金済みとして終えました';

const REJECTED_MESSAGE =
  '形式の誤りで拒否されたスポンサー広告の返金の依頼を、再処理の対象から外しました';

const LOG_FIELDS = [
  'category',
  'code',
  'incident',
  'level',
  'message',
  'refundKind',
  'sponsorshipId',
  'time',
];

let events: Event[] = [];
let logs: LogObject[] = [];

function startRecording(appName: LoggingOptions['appName'] = 'api'): void {
  resetSponsorshipObservability();
  logs = recordSponsorshipLogs(appName);
  events = recordSponsorshipEvents();
}

beforeEach(() => {
  startRecording();
});

afterEach(() => {
  resetSponsorshipObservability();
});

function onlyLog(): LogObject | undefined {
  const [log, ...others] = logs;
  expect(others).toEqual([]);
  return log;
}

function onlyEvent(): Event | undefined {
  const [event, ...others] = events;
  expect(others).toEqual([]);
  return event;
}

describe('reportSponsorshipIncident', () => {
  test.each<RefundKind>(['termination', 'display_stop'])(
    '返金済み(%s)はwarningのイベントとwarnのログを、異常の種類の指紋と識別子・種類・コードのタグで送る',
    (refundKind) => {
      reportSponsorshipIncident({
        appName: 'api',
        incident: 'refund-already-settled',
        sponsorshipId: SPONSORSHIP_ID,
        refundKind,
        code: 'amount_exceeds_refundable',
      });

      const event = onlyEvent();
      expect(event?.level).toBe('warning');
      expect(event?.logentry?.message).toBe(ALREADY_SETTLED_MESSAGE);
      expect(event?.message).toBeUndefined();
      expect(event?.fingerprint).toEqual([
        'sponsorship',
        'refund-already-settled',
      ]);
      expect(event?.tags).toStrictEqual({
        sponsorship_incident: 'refund-already-settled',
        sponsorship_id: SPONSORSHIP_ID,
        refund_kind: refundKind,
        refund_code: 'amount_exceeds_refundable',
      });
      expect(onlyLog()).toMatchObject({
        level: 'warning',
        category: 'api.sponsorship.refund',
        message: ALREADY_SETTLED_MESSAGE,
        incident: 'refund-already-settled',
        sponsorshipId: SPONSORSHIP_ID,
        refundKind,
        code: 'amount_exceeds_refundable',
      });
    },
  );

  test.each<SponsorshipIncidentCode>([
    'invalid_amount',
    'invalid_request_key',
    'invalid_reason',
  ])(
    '拒否(%s)はerrorのイベントとerrorのログを、異常の種類の指紋と識別子・種類・コードのタグで送る',
    (code) => {
      reportSponsorshipIncident({
        appName: 'api',
        incident: 'refund-rejected',
        sponsorshipId: SPONSORSHIP_ID,
        refundKind: 'display_stop',
        code,
      });

      const event = onlyEvent();
      expect(event?.level).toBe('error');
      expect(event?.logentry?.message).toBe(REJECTED_MESSAGE);
      expect(event?.message).toBeUndefined();
      expect(event?.fingerprint).toEqual(['sponsorship', 'refund-rejected']);
      expect(event?.tags).toStrictEqual({
        sponsorship_incident: 'refund-rejected',
        sponsorship_id: SPONSORSHIP_ID,
        refund_kind: 'display_stop',
        refund_code: code,
      });
      expect(onlyLog()).toMatchObject({
        level: 'error',
        category: 'api.sponsorship.refund',
        message: REJECTED_MESSAGE,
        incident: 'refund-rejected',
        sponsorshipId: SPONSORSHIP_ID,
        refundKind: 'display_stop',
        code,
      });
    },
  );

  test.each([
    { label: '小文字のULID', sponsorshipId: SPONSORSHIP_ID.toLowerCase() },
    { label: '名称のような文字列', sponsorshipId: 'My Product 広告' },
    { label: '空文字', sponsorshipId: '' },
  ])(
    '申込のIDが大文字のULIDでない($label)とき、タグとログの申込のIDをunknownにする',
    ({ sponsorshipId }) => {
      reportSponsorshipIncident({
        appName: 'api',
        incident: 'refund-rejected',
        sponsorshipId,
        refundKind: 'termination',
        code: 'invalid_amount',
      });

      expect(onlyEvent()?.tags?.['sponsorship_id']).toBe('unknown');
      expect(onlyLog()?.['sponsorshipId']).toBe('unknown');
    },
  );

  test('ログのカテゴリは呼び出し元のアプリ名で始まる', () => {
    startRecording('event');

    reportSponsorshipIncident({
      appName: 'event',
      incident: 'refund-already-settled',
      sponsorshipId: SPONSORSHIP_ID,
      refundKind: 'display_stop',
      code: 'amount_exceeds_refundable',
    });

    expect(onlyLog()?.category).toBe('event.sponsorship.refund');
    expect(onlyEvent()?.fingerprint).toEqual([
      'sponsorship',
      'refund-already-settled',
    ]);
  });

  test('イベントとログは識別子・種類・コードだけを持ち、名称・理由・金額を含めない', () => {
    reportSponsorshipIncident({
      appName: 'api',
      incident: 'refund-rejected',
      sponsorshipId: SPONSORSHIP_ID,
      refundKind: 'termination',
      code: 'invalid_reason',
    });

    const event = onlyEvent();
    expect(Object.keys(event?.tags ?? {}).sort()).toEqual([
      'refund_code',
      'refund_kind',
      'sponsorship_id',
      'sponsorship_incident',
    ]);
    expect(event?.extra).toBeUndefined();
    expect(event?.contexts?.['sponsorship']).toBeUndefined();
    expect(event?.logentry?.params).toBeUndefined();
    expect(Object.keys(onlyLog() ?? {}).sort()).toEqual(LOG_FIELDS);
  });
});
