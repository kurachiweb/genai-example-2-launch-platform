import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  DEFAULT_RETRY_POLICY,
  QUEUE_MAX_RETRIES,
} from '../../lib/core/messaging/retry-policy.ts';
import {
  EMAIL_CONFIG_KEY_PATTERN,
  readWranglerConfig,
} from '../support/wrangler-config.ts';

const emailConfigSchema = z.object({
  vars: z.record(z.string(), z.unknown()),
  secrets: z.object({ required: z.array(z.string()) }).optional(),
  send_email: z
    .array(
      z.object({
        name: z.string(),
        destination_address: z.string().optional(),
        allowed_destination_addresses: z.array(z.string()).optional(),
        allowed_sender_addresses: z.array(z.string()).optional(),
        remote: z.boolean().optional(),
      }),
    )
    .optional(),
  queues: z.object({
    producers: z
      .array(z.object({ binding: z.string(), queue: z.string() }))
      .optional(),
    consumers: z
      .array(
        z.object({
          queue: z.string(),
          max_batch_size: z.number().optional(),
          max_batch_timeout: z.number().optional(),
          max_retries: z.number().optional(),
          dead_letter_queue: z.string().optional(),
          retry_delay: z.number().optional(),
        }),
      )
      .optional(),
  }),
});

type EmailConfig = z.infer<typeof emailConfigSchema>;

// 要件の決定事項Q6の送信ドメイン。ローカルは外部へ送らないため予約済みのドメインを使う
const SEND_DOMAINS = {
  local: 'local.example',
  staging: 'genai-example-2-mail-staging.lab.kurachiweb.com',
  prod: 'genai-example-2-mail.lab.kurachiweb.com',
} as const;

const SECRET_ONLY_KEYS = [
  'EMAIL_ALLOWED_RECIPIENTS',
  'EMAIL_SMOKE_TOKEN',
  'EMAIL_SMOKE_RECIPIENT',
] as const;

const SECRET_LIKE_KEY_PATTERN =
  /TOKEN|SECRET|PASSWORD|DSN|PEPPER|_RECIPIENTS?$/;

interface ExpectedEmailEnvironment {
  readonly label: string;
  readonly wranglerEnv: string | undefined;
  readonly resourceSuffix: string;
  readonly sendDomain: string;
  readonly vars: Readonly<Record<string, string>>;
  readonly hasSendBinding: boolean;
  readonly requiredEmailSecrets: readonly string[];
}

function emailVars(
  provider: string,
  sendDomain: string,
  recipientPolicy: string,
  resourceSuffix: string,
  extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return {
    EMAIL_PROVIDER: provider,
    EMAIL_FROM_ADDRESS: `noreply@${sendDomain}`,
    EMAIL_RECIPIENT_POLICY: recipientPolicy,
    EMAIL_EVENTS_QUEUE_NAME: `genai-example-2-email-events-${resourceSuffix}`,
    ...extra,
  };
}

const EXPECTED_ENVIRONMENTS: readonly ExpectedEmailEnvironment[] = [
  {
    label: 'ローカル(ルート)',
    wranglerEnv: undefined,
    resourceSuffix: 'dev',
    sendDomain: SEND_DOMAINS.local,
    vars: emailVars('mailpit', SEND_DOMAINS.local, 'any', 'dev', {
      MAILPIT_API_URL: 'http://127.0.0.1:48041',
    }),
    hasSendBinding: false,
    requiredEmailSecrets: [],
  },
  {
    label: 'staging',
    wranglerEnv: 'staging',
    resourceSuffix: 'staging',
    sendDomain: SEND_DOMAINS.staging,
    vars: emailVars('cloudflare', SEND_DOMAINS.staging, 'allowlist', 'staging'),
    hasSendBinding: true,
    requiredEmailSecrets: ['EMAIL_ALLOWED_RECIPIENTS'],
  },
  {
    label: 'prod',
    wranglerEnv: 'prod',
    resourceSuffix: 'prod',
    sendDomain: SEND_DOMAINS.prod,
    vars: emailVars('cloudflare', SEND_DOMAINS.prod, 'any', 'prod'),
    hasSendBinding: true,
    requiredEmailSecrets: [],
  },
];

function readEventConfig(wranglerEnv: string | undefined): EmailConfig {
  return emailConfigSchema.parse(readWranglerConfig('event', wranglerEnv));
}

function pickEmailEntries(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) =>
      EMAIL_CONFIG_KEY_PATTERN.test(key),
    ),
  );
}

describe.each(EXPECTED_ENVIRONMENTS)(
  'イベントサーバーのメールのWrangler設定($label)',
  (env) => {
    const event = readEventConfig(env.wranglerEnv);
    const emailEventsQueue = `genai-example-2-email-events-${env.resourceSuffix}`;
    const jobsDlq = `genai-example-2-jobs-dlq-${env.resourceSuffix}`;

    test('メールの変数を環境ごとの値で持つ', () => {
      expect(pickEmailEntries(event.vars)).toStrictEqual(env.vars);
    });

    test('送信元のドメインが環境の送信ドメインと一致する', () => {
      const fromAddress = event.vars['EMAIL_FROM_ADDRESS'];

      expect(fromAddress).toBeString();
      expect(String(fromAddress).split('@')).toEqual([
        'noreply',
        env.sendDomain,
      ]);
    });

    test('送信バインディングはstaging・prodだけが持ち、送信元を変数の送信元だけに許可する', () => {
      const fromAddress = String(event.vars['EMAIL_FROM_ADDRESS']);
      const expected = env.hasSendBinding
        ? [{ name: 'EMAIL', allowed_sender_addresses: [fromAddress] }]
        : [];

      expect(event.send_email ?? []).toStrictEqual(expected);
    });

    test('メールの必須シークレットは環境の宛先制限の方針に対応する', () => {
      const required = event.secrets?.required ?? [];

      expect(
        required.filter((key) => EMAIL_CONFIG_KEY_PATTERN.test(key)),
      ).toEqual([...env.requiredEmailSecrets]);
      expect(required.includes('EMAIL_ALLOWED_RECIPIENTS')).toBe(
        event.vars['EMAIL_RECIPIENT_POLICY'] === 'allowlist',
      );
    });

    test('変数にシークレットにすべき項目が無い', () => {
      const varKeys = Object.keys(event.vars);

      for (const key of SECRET_ONLY_KEYS) {
        expect(varKeys).not.toContain(key);
      }
      expect(
        varKeys.filter((key) => SECRET_LIKE_KEY_PATTERN.test(key)),
      ).toEqual([]);
    });

    test('メールイベント用Queueを受信し、再試行の上限を超えたら本体のデッドレターへ移す', () => {
      const consumer = event.queues.consumers?.find(
        (entry) => entry.queue === emailEventsQueue,
      );

      expect(consumer).toStrictEqual({
        queue: emailEventsQueue,
        max_batch_size: 10,
        max_batch_timeout: 5,
        max_retries: QUEUE_MAX_RETRIES,
        dead_letter_queue: jobsDlq,
        retry_delay: 30,
      });
      expect(DEFAULT_RETRY_POLICY.maxAttempts).toBeLessThan(
        consumer?.max_retries ?? 0,
      );
    });

    test('メールイベント用Queueへ送るバインディングを持たない', () => {
      expect(
        (event.queues.producers ?? []).map((producer) => producer.queue),
      ).not.toContain(emailEventsQueue);
    });
  },
);
