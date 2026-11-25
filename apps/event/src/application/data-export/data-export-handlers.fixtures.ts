import type {
  DataExportIncident,
  DataExportIncidentReporter,
  DataExportRecord,
  DataExportStore,
  DataExportTerminator,
} from '../../../lib/core/data-export/ports.ts';
import type { MessageMeta } from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

export const EXPORT_ID = '01JE0DXPT00000000000000001';
export const USER_ID = '01JE0DXUS00000000000000001';
export const NOW = new Date('2026-11-22T04:21:00.000Z');
export const BODY = Object.freeze({ exportId: EXPORT_ID });

export const clockAt = (now: Date): Clock => ({ now: () => now });

export function metaOf(attempts: number): MessageMeta {
  return {
    id: '01JE0DXMS00000000000000001',
    type: 'data-export.test',
    attempts,
    sentAt: new Date('2026-11-22T02:21:00.000Z'),
  };
}

export function recordOf(
  overrides: Partial<DataExportRecord> = {},
): DataExportRecord {
  const at = new Date('2026-11-22T02:21:00.000Z');
  return {
    id: EXPORT_ID,
    userId: USER_ID,
    status: 'generating',
    requestedAt: at,
    runToken: null,
    leaseExpiresAt: null,
    attempts: 0,
    uploadId: null,
    objectKey: null,
    fileName: null,
    byteSize: null,
    completedAt: null,
    expiresAt: null,
    failedAt: null,
    failureKind: null,
    noticeStatus: 'none',
    updatedAt: at,
    ...overrides,
  };
}

type FailInput = Parameters<DataExportTerminator['fail']>[0];

export interface FakeTerminator {
  readonly terminator: DataExportTerminator;
  readonly calls: FailInput[];
}

export function fakeTerminator(
  result: 'failed' | 'already_finished' | Error = 'failed',
): FakeTerminator {
  const calls: FailInput[] = [];
  return {
    calls,
    terminator: {
      fail: (input) => {
        calls.push(input);
        return result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result);
      },
    },
  };
}

export interface FakeReporter {
  readonly reporter: DataExportIncidentReporter;
  readonly incidents: DataExportIncident[];
}

export function fakeReporter(): FakeReporter {
  const incidents: DataExportIncident[] = [];
  return {
    incidents,
    reporter: { report: (incident) => void incidents.push(incident) },
  };
}

export function storeFinding(
  record: DataExportRecord | undefined,
): Pick<DataExportStore, 'find'> {
  return { find: () => Promise.resolve(record) };
}
