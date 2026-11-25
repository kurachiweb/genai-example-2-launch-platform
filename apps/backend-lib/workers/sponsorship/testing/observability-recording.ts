import { resetSync } from '@logtape/logtape';
import {
  CloudflareClient,
  type Event,
  getCurrentScope,
} from '@sentry/cloudflare';

import type { LogObject } from '../../../core/logging/log-record.ts';
import {
  ensureLoggingConfigured,
  type LoggingOptions,
} from '../../logging/configure-logging.ts';

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

export function recordSponsorshipLogs(
  appName: LoggingOptions['appName'] = 'api',
): LogObject[] {
  const logs: LogObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LogObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      trace: record,
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

// 送信はせず、beforeSendに届いたイベントだけを集める
export function recordSponsorshipEvents(): Event[] {
  const events: Event[] = [];
  const client = new CloudflareClient({
    dsn: TEST_DSN,
    integrations: [],
    stackParser: () => [],
    transport: () => ({
      send: () => Promise.resolve({}),
      flush: () => Promise.resolve(true),
    }),
    beforeSend: (event) => {
      events.push(event);
      return null;
    },
  });
  getCurrentScope().setClient(client);
  client.init();
  return events;
}

export function resetSponsorshipObservability(): void {
  getCurrentScope().setClient(undefined);
  resetSync();
}
