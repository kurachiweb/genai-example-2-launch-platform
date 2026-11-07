import { describe, expect, test } from 'bun:test';

import type { MessageContract } from '../../core/messaging/message-contract.ts';
import type { Clock } from '../../core/time/clock.ts';
import { ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE } from '../../core/ultras/activation-message.ts';
import type { ActivationStore } from '../../core/ultras/ports.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import type {
  MessagePublisher,
  PublishOptions,
} from '../messaging/queue-publisher.ts';
import { QueueActivationDispatcher } from './activation-dispatcher.ts';

const ACTIVATION_ID = '01JC0ACTV00000000000000001';
const NOW = new Date('2026-11-06T04:21:00.000Z');
const clock: Clock = { now: () => NOW };

interface PublishedMessage {
  readonly type: string;
  readonly body: unknown;
  readonly options: PublishOptions | undefined;
}

interface RecordingPublisher {
  readonly publisher: MessagePublisher;
  readonly published: PublishedMessage[];
}

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [attribute: string]: unknown;
}

interface DispatchMark {
  readonly id: string;
  readonly at: Date;
}

interface RecordingActivationStore {
  readonly store: ActivationStore;
  readonly dispatched: DispatchMark[];
}

// 実際の送信と同じく、本文が契約の検証規則に合わなければ拒否する
function createRecordingPublisher(failure?: Error): RecordingPublisher {
  const published: PublishedMessage[] = [];
  const publisher: MessagePublisher = {
    publish: <TType extends string, TBody>(
      contract: MessageContract<TType, TBody>,
      body: TBody,
      options?: PublishOptions,
    ) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      contract.schema.parse(body);
      published.push({ type: contract.type, body, options });
      return Promise.resolve(
        `01JC0MSG${String(published.length).padStart(18, '0')}`,
      );
    },
  };
  return { publisher, published };
}

function unused(): never {
  throw new Error('このテストでは使わない操作です');
}

function createRecordingActivationStore(
  markFailure?: Error,
): RecordingActivationStore {
  const dispatched: DispatchMark[] = [];
  const store: ActivationStore = {
    findById: unused,
    findByStripeId: unused,
    markDispatched: (id, at) => {
      if (markFailure !== undefined) {
        return Promise.reject(markFailure);
      }
      dispatched.push({ id, at });
      return Promise.resolve();
    },
    markCompleted: unused,
    findUndispatched: unused,
    deleteCompletedBefore: unused,
  };
  return { store, dispatched };
}

function recordLogs(appName: 'api' | 'event' = 'api'): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

function dispatcherWith(parts: {
  readonly appName?: 'api' | 'event';
  readonly publisher: MessagePublisher;
  readonly activations: ActivationStore;
}): QueueActivationDispatcher {
  return new QueueActivationDispatcher({
    appName: parts.appName ?? 'api',
    publisher: parts.publisher,
    activations: parts.activations,
    clock,
  });
}

describe('QueueActivationDispatcher', () => {
  test('知らせの契約と加入のIDの本文で送り出し、成功したら現在時刻で送り出しの記録を残す', async () => {
    const logs = recordLogs();
    const { publisher, published } = createRecordingPublisher();
    const { store, dispatched } = createRecordingActivationStore();
    const dispatcher = dispatcherWith({ publisher, activations: store });

    await dispatcher.dispatch(ACTIVATION_ID);

    expect(published).toEqual([
      {
        type: ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type,
        body: { activationId: ACTIVATION_ID },
        options: undefined,
      },
    ]);
    expect(dispatched).toEqual([{ id: ACTIVATION_ID, at: NOW }]);
    expect(logs).toEqual([]);
  });

  test('送り出しに失敗したら例外を投げず、送り出しの記録を残さず、加入のIDを添えたwarnのログだけを出す', async () => {
    const logs = recordLogs('event');
    const { publisher, published } = createRecordingPublisher(
      new Error('queue unavailable'),
    );
    const { store, dispatched } = createRecordingActivationStore();
    const dispatcher = dispatcherWith({
      appName: 'event',
      publisher,
      activations: store,
    });

    await dispatcher.dispatch(ACTIVATION_ID);

    expect(published).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(logs).toMatchObject([
      {
        level: 'warning',
        category: 'event.application.ultras',
        activationId: ACTIVATION_ID,
        stage: 'publish',
        error: { message: 'queue unavailable' },
      },
    ]);
  });

  test('送り出しの後の記録に失敗しても例外を投げず、加入のIDを添えたwarnのログだけを出す', async () => {
    const logs = recordLogs();
    const { publisher, published } = createRecordingPublisher();
    const { store, dispatched } = createRecordingActivationStore(
      new Error('database unavailable'),
    );
    const dispatcher = dispatcherWith({ publisher, activations: store });

    await dispatcher.dispatch(ACTIVATION_ID);

    expect(published).toHaveLength(1);
    expect(dispatched).toEqual([]);
    expect(logs).toMatchObject([
      {
        level: 'warning',
        category: 'api.application.ultras',
        activationId: ACTIVATION_ID,
        stage: 'mark_dispatched',
        error: { message: 'database unavailable' },
      },
    ]);
  });
});
