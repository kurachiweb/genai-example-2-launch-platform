import type { LogRecord } from '@logtape/logtape';
import { z } from 'zod';

import {
  type AnyEmailKind,
  createEmailKindRegistry,
  defineEmailKind,
  type EmailKindRegistry,
} from '../../../lib/core/email/email-kind.ts';
import type {
  AlertThrottle,
  SenderInfo,
  SenderInfoProvider,
  SendRecordStore,
  SuppressionList,
  SuppressionStatus,
} from '../../../lib/core/email/ports.ts';
import type { EmailProviderOutcome } from '../../../lib/core/email/provider-outcome.ts';
import type { EmailSendBody } from '../../../lib/core/email/send-message.ts';
import type { MessageMeta } from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { capturedLogsOf } from './email-log-capture.fixtures.ts';
import type {
  EmailIncident,
  EmailIncidentReporter,
  EmailProvider,
  EmailRenderer,
  EmailRuntimeConfig,
  OutgoingEmail,
  RenderedEmail,
} from './ports.ts';
import { SendEmailHandler } from './send-email-handler.ts';

export const NOW = new Date('2030-01-15T12:00:00.000Z');
export const SEND_DURATION_MS = 250;
export const AFTER_SEND = new Date(NOW.getTime() + SEND_DURATION_MS);
export const REQUEST_ID = '01HZX3K6Y8Q2N4R7T9V1W3Y5Z7';
export const RECIPIENT = 'Recipient.Person@recipient.example';
export const SECRET_URL = 'https://link.example/reset?code=secret-path';
export const INPUT_VALUE = '入力に含まれる秘密の値';
export const SUBJECT = '件名に含まれる秘密の文言';
export const RENDERED: RenderedEmail = {
  subject: SUBJECT,
  html: `<p>${INPUT_VALUE}</p><a href="${SECRET_URL}">開く</a>`,
  text: `${INPUT_VALUE}\n${SECRET_URL}`,
};
export const SENDER_INFO: SenderInfo = {
  businessName: '送信者の事業者名',
  contactEmail: 'contact@sender.example',
  postalAddress: '送信者の所在地',
};
export const PROVIDER_MESSAGE_ID = 'provider-message-1';

const RUNTIME_CONFIG: EmailRuntimeConfig = {
  fromAddress: 'noreply@mail.example',
  fromName: 'Launch Stadium',
};

const LOG_CATEGORY = ['event', 'application', 'email-send'] as const;

const testInput = z.object({ title: z.string(), url: z.string() });

export const TRANSACTIONAL_KIND = defineEmailKind({
  name: 'test.transactional',
  category: 'transactional',
  inputSchema: testInput,
});

export const NOTIFICATION_KIND = defineEmailKind({
  name: 'test.notification',
  category: 'notification',
  inputSchema: testInput,
});

export const VALID_INPUT = { title: INPUT_VALUE, url: SECRET_URL };

export type PortCall =
  | { readonly port: 'hasSent'; readonly requestId: string }
  | {
      readonly port: 'markSent';
      readonly requestId: string;
      readonly kind: string;
      readonly sentAt: Date;
    }
  | { readonly port: 'getStatus'; readonly address: string }
  | { readonly port: 'senderInfo' }
  | {
      readonly port: 'render';
      readonly kind: AnyEmailKind;
      readonly input: unknown;
      readonly senderInfo: SenderInfo | undefined;
    }
  | { readonly port: 'send'; readonly email: OutgoingEmail }
  | {
      readonly port: 'tryAcquire';
      readonly name: string;
      readonly now: Date;
      readonly intervalSeconds: number;
    };

export interface HarnessOptions {
  readonly sent?: boolean;
  readonly markSent?: () => Promise<void>;
  readonly suppressed?: boolean;
  readonly senderInfo?: () => Promise<SenderInfo | undefined>;
  readonly render?: () => Promise<RenderedEmail>;
  readonly outcome?: EmailProviderOutcome;
  readonly tryAcquire?: () => Promise<boolean>;
}

export interface Bindings {
  readonly kinds: EmailKindRegistry;
  readonly sendRecords: SendRecordStore;
  readonly suppressions: SuppressionList;
  readonly senderInfo: SenderInfoProvider;
  readonly alertThrottle: AlertThrottle;
  readonly renderer: EmailRenderer;
  readonly provider: EmailProvider;
  readonly reporter: EmailIncidentReporter;
  readonly config: EmailRuntimeConfig;
  readonly clock: Clock;
}

export interface Harness {
  readonly handler: SendEmailHandler;
  readonly calls: PortCall[];
  readonly incidents: EmailIncident[];
  readonly bindings: Bindings;
}

const SUPPRESSED_STATUS: SuppressionStatus = {
  suppressed: true,
  lastReason: 'hard_bounce',
  lastEventAt: new Date('2030-01-01T00:00:00.000Z'),
  expiresAt: null,
};

const NOT_SUPPRESSED_STATUS: SuppressionStatus = { suppressed: false };

// 送信の呼び出しだけが時計を進め、所要時間を送信の有無で見分けられるようにする
function createBindings(
  options: HarnessOptions,
  calls: PortCall[],
  incidents: EmailIncident[],
): Bindings {
  let current = NOW.getTime();
  return {
    kinds: createEmailKindRegistry([TRANSACTIONAL_KIND, NOTIFICATION_KIND]),
    sendRecords: {
      hasSent: (requestId) => {
        calls.push({ port: 'hasSent', requestId });
        return Promise.resolve(options.sent ?? false);
      },
      markSent: (requestId, kind, sentAt) => {
        calls.push({ port: 'markSent', requestId, kind, sentAt });
        return options.markSent?.() ?? Promise.resolve();
      },
    },
    suppressions: {
      getStatus: (address) => {
        calls.push({ port: 'getStatus', address });
        return Promise.resolve(
          options.suppressed === true
            ? SUPPRESSED_STATUS
            : NOT_SUPPRESSED_STATUS,
        );
      },
      findSuppressed: () => Promise.reject(new Error('呼ばれない想定です')),
    },
    senderInfo: {
      get: () => {
        calls.push({ port: 'senderInfo' });
        return options.senderInfo?.() ?? Promise.resolve(SENDER_INFO);
      },
    },
    alertThrottle: {
      tryAcquire: (name, now, intervalSeconds) => {
        calls.push({ port: 'tryAcquire', name, now, intervalSeconds });
        return options.tryAcquire?.() ?? Promise.resolve(true);
      },
    },
    renderer: {
      render: (kind, input, senderInfo) => {
        calls.push({ port: 'render', kind, input, senderInfo });
        return options.render?.() ?? Promise.resolve(RENDERED);
      },
    },
    provider: {
      send: (email) => {
        calls.push({ port: 'send', email });
        current += SEND_DURATION_MS;
        return Promise.resolve(
          options.outcome ?? {
            kind: 'sent',
            providerMessageId: PROVIDER_MESSAGE_ID,
          },
        );
      },
    },
    reporter: {
      report: (incident) => {
        incidents.push(incident);
      },
    },
    config: RUNTIME_CONFIG,
    clock: { now: () => new Date(current) },
  };
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const calls: PortCall[] = [];
  const incidents: EmailIncident[] = [];
  const bindings = createBindings(options, calls, incidents);
  const handler = new SendEmailHandler(
    bindings.kinds,
    bindings.sendRecords,
    bindings.suppressions,
    bindings.senderInfo,
    bindings.alertThrottle,
    bindings.renderer,
    bindings.provider,
    bindings.reporter,
    bindings.config,
    bindings.clock,
  );
  return { handler, calls, incidents, bindings };
}

export function bodyOf(overrides: Partial<EmailSendBody> = {}): EmailSendBody {
  return {
    kind: TRANSACTIONAL_KIND.name,
    to: RECIPIENT,
    input: VALID_INPUT,
    ...overrides,
  };
}

export function metaOf(attempts = 1): MessageMeta {
  return {
    id: REQUEST_ID,
    type: 'email.send',
    attempts,
    sentAt: new Date('2030-01-15T11:59:00.000Z'),
  };
}

export function portsOf(calls: readonly PortCall[]): string[] {
  return calls.map((call) => call.port);
}

export function handlerLogs(): LogRecord[] {
  return capturedLogsOf(LOG_CATEGORY);
}

export function errorLogs(): LogRecord[] {
  return handlerLogs().filter(
    (record) =>
      record.level === 'error' && !Object.hasOwn(record.properties, 'result'),
  );
}

// 送信処理1件ごとに結果のログがちょうど1件出ることも確かめる
export function resultLog(): LogRecord {
  const results = handlerLogs().filter((record) =>
    Object.hasOwn(record.properties, 'result'),
  );
  const [log] = results;
  if (results.length !== 1 || log === undefined) {
    throw new Error(
      `結果のログが1件ではありません: ${String(results.length)}件`,
    );
  }
  return log;
}
