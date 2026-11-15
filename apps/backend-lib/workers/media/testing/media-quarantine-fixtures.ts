import { createUlidGenerator } from '../../../core/ids/id-generator.ts';
import { RELOCATE_FILES_MESSAGE } from '../../../core/media/media-messages.ts';
import type { MediaFileStore } from '../../../core/media/ports.ts';
import { MESSAGE_CONTRACTS } from '../../../core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../core/messaging/envelope.ts';
import { systemClock } from '../../../core/time/clock.ts';
import { createMessagePublisher } from '../../messaging/queue-publisher.ts';
import { MediaQuarantineService } from '../media-quarantine-service.ts';
import { createStore } from './media-file-store-fixtures.ts';

export interface HookedQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: readonly QueueEnvelope[];
}

// 送信の時点のD1の状態を確かめたり、決めた回数目の送信を失敗させたりするため、送信のたびに呼ぶ処理を差し込む
export function createHookedQueue(
  onSend: (envelope: QueueEnvelope, attempt: number) => Promise<void> = () =>
    Promise.resolve(),
): HookedQueue {
  const sent: QueueEnvelope[] = [];
  let attempt = 0;
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: async (body) => {
      attempt += 1;
      await onSend(body, attempt);
      sent.push(body);
      return {
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      };
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

export function failingFromAttempt(
  failingAttempt: number,
  failure: Error,
): (envelope: QueueEnvelope, attempt: number) => Promise<void> {
  return (_envelope, attempt) =>
    attempt >= failingAttempt ? Promise.reject(failure) : Promise.resolve();
}

export interface QuarantineParts {
  readonly files?: MediaFileStore;
  readonly queue?: Queue<QueueEnvelope>;
}

export interface QuarantineUnderTest {
  readonly quarantine: MediaQuarantineService;
  readonly sent: readonly QueueEnvelope[];
}

export function createQuarantine(
  parts: QuarantineParts = {},
): QuarantineUnderTest {
  const recording = createHookedQueue();
  return {
    quarantine: new MediaQuarantineService({
      files: parts.files ?? createStore(),
      publisher: createMessagePublisher(
        parts.queue ?? recording.queue,
        MESSAGE_CONTRACTS,
        createUlidGenerator(systemClock),
        systemClock,
      ),
      appName: 'api',
    }),
    sent: recording.sent,
  };
}

export function relocateMessagesOf(
  sent: readonly QueueEnvelope[],
): (readonly string[])[] {
  return sent
    .filter((envelope) => envelope.type === RELOCATE_FILES_MESSAGE.type)
    .map(
      (envelope) => (envelope.body as { fileIds: readonly string[] }).fileIds,
    );
}

export function relocatedIdsOf(sent: readonly QueueEnvelope[]): string[] {
  return relocateMessagesOf(sent).flat().toSorted();
}
