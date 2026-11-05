import { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import { createEmailKindRegistry } from '../../../lib/core/email/email-kind.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import { INQUIRY_REPLY_NOTIFICATION_KIND } from '../../../lib/core/email/kinds/inquiry.ts';
import { EMAIL_KINDS } from '../../../lib/core/email/kinds/index.ts';
import type { EmailSender } from '../../../lib/core/email/ports.ts';
import type { EmailSendBody } from '../../../lib/core/email/send-message.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../../lib/core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { createEmailSender } from '../../../lib/workers/email/email-sender.ts';
import { createMessagePublisher } from '../../../lib/workers/messaging/queue-publisher.ts';
import { INQUIRY_TYPES } from '../../application/inquiry/inquiry-types.ts';
import type {
  InquiryMailer,
  InquiryReplyNotification,
  InquirySettings,
} from '../../application/inquiry/ports.ts';
import { EmailInquiryMailer } from './email-inquiry-mailer.ts';

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

const CLIENT_ORIGIN = 'https://client.example';

const LOCAL_CLIENT_ORIGIN = 'http://localhost:48044';

const INQUIRY_ID = '01JC0MINQ00000000000000001';

const REPLIED_AT = new Date('2026-11-05T03:04:05.678Z');

const fixedClock: Clock = { now: () => new Date(REPLIED_AT) };

const fixedIds: IdGenerator = { generate: () => '01JBM3Y7Q2M4N5P6R7S8T9V0W1' };

const NOTIFICATION: InquiryReplyNotification = {
  to: 'taro.yamada@mail.example',
  nickname: 'やまだ たろう',
  inquiryId: INQUIRY_ID,
  repliedAt: REPLIED_AT,
};

function createRecordingQueue(): RecordingQueue {
  const sent: QueueEnvelope[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

function createSender(queue: Queue<QueueEnvelope>): EmailSender {
  return createEmailSender(
    createMessagePublisher(queue, MESSAGE_CONTRACTS, fixedIds, fixedClock),
    createEmailKindRegistry(EMAIL_KINDS),
  );
}

function createMailer(
  queue: Queue<QueueEnvelope>,
  clientOrigin: string = CLIENT_ORIGIN,
): InquiryMailer {
  const settings: InquirySettings = { clientOrigin };
  return new EmailInquiryMailer(createSender(queue), settings);
}

function onlyBody(sent: readonly QueueEnvelope[]): EmailSendBody {
  expect(sent).toHaveLength(1);
  expect(sent[0]?.type).toBe('email.send');
  return sent[0]?.body as EmailSendBody;
}

describe('EmailInquiryMailer.sendReplyNotification', () => {
  test('返信の通知メールを、宛先・ニックネーム・チャットページのリンク・返信日時だけで送信期限なしに要求する', async () => {
    const { queue, sent } = createRecordingQueue();

    await createMailer(queue).sendReplyNotification(NOTIFICATION);

    expect(onlyBody(sent)).toStrictEqual({
      kind: INQUIRY_REPLY_NOTIFICATION_KIND.name,
      to: NOTIFICATION.to,
      input: {
        nickname: NOTIFICATION.nickname,
        inquiryUrl: `${CLIENT_ORIGIN}/inquiries/${INQUIRY_ID}`,
        repliedAt: REPLIED_AT.toISOString(),
      },
    });
  });

  test.each([
    { label: 'ローカルのHTTP', origin: LOCAL_CLIENT_ORIGIN },
    { label: 'HTTPS', origin: CLIENT_ORIGIN },
  ])(
    '$labelの利用者側のオリジンとチャットページのパスでリンクを組み、クエリもフラグメントも付けない',
    async ({ origin }) => {
      const { queue, sent } = createRecordingQueue();

      await createMailer(queue, origin).sendReplyNotification(NOTIFICATION);

      const input = onlyBody(sent).input as Record<string, string>;
      const link = new URL(input.inquiryUrl ?? '');
      expect(link.origin).toBe(origin);
      expect(link.pathname).toBe(`/inquiries/${INQUIRY_ID}`);
      expect(link.search).toBe('');
      expect(link.hash).toBe('');
    },
  );

  test('送信要求の失敗は、そのまま呼び出し側へ伝える', async () => {
    const { queue } = createRecordingQueue();
    const failure = new Error('Queueに送れない');
    const failingQueue: Queue<QueueEnvelope> = {
      ...queue,
      send: () => Promise.reject(failure),
    };

    await expect(
      createMailer(failingQueue).sendReplyNotification(NOTIFICATION),
    ).rejects.toBe(failure);
  });

  test('コンテナでメールの送信と利用者側のオリジンの設定を注入して解決できる', async () => {
    const { queue, sent } = createRecordingQueue();
    const container = new Container();
    container
      .bind<EmailSender>(EMAIL_TYPES.EmailSender)
      .toConstantValue(createSender(queue));
    container
      .bind<InquirySettings>(INQUIRY_TYPES.InquirySettings)
      .toConstantValue({ clientOrigin: CLIENT_ORIGIN });
    container
      .bind<InquiryMailer>(INQUIRY_TYPES.InquiryMailer)
      .to(EmailInquiryMailer);

    await container
      .get<InquiryMailer>(INQUIRY_TYPES.InquiryMailer)
      .sendReplyNotification(NOTIFICATION);

    expect(onlyBody(sent).kind).toBe(INQUIRY_REPLY_NOTIFICATION_KIND.name);
  });
});
