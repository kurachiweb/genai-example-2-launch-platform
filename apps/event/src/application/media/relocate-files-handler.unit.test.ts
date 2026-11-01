import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type {
  MessageHandler,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import type { RelocateFilesBody } from '../../../lib/core/media/media-messages.ts';
import type { FileRelocator } from './ports.ts';
import { RelocateFilesHandler } from './relocate-files-handler.ts';

const FILE_IDS = ['01J8Z3Y7Q2M4N5P6R7S8T9V0W1', '01J8Z3Y7Q2M4N5P6R7S8T9V0W2'];

const META: MessageMeta = {
  id: 'message-1',
  type: 'media.relocate-files',
  attempts: 1,
  sentAt: new Date('2030-01-15T11:59:30.000Z'),
};

const records: LogRecord[] = [];

beforeAll(() => {
  configureSync({
    reset: true,
    sinks: { capture: (record) => records.push(record) },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterAll(() => {
  resetSync();
});

beforeEach(() => {
  records.length = 0;
});

function createRelocator(
  reconcile: FileRelocator['reconcile'],
): FileRelocator & { readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    reconcile: (fileIds) => {
      calls.push(fileIds);
      return reconcile(fileIds);
    },
  };
}

describe('RelocateFilesHandler', () => {
  test('本文のファイルの識別子をそのまま保存先をそろえる処理へ渡して完了する', async () => {
    const relocator = createRelocator(() => Promise.resolve({ moved: 1 }));
    const handler: MessageHandler<RelocateFilesBody> = new RelocateFilesHandler(
      relocator,
    );

    const result = await handler.handle({ fileIds: FILE_IDS }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(relocator.calls).toEqual([FILE_IDS]);
  });

  test('依頼された件数と移した件数を、識別子を含めずにログへ出す', async () => {
    const handler: MessageHandler<RelocateFilesBody> = new RelocateFilesHandler(
      createRelocator(() => Promise.resolve({ moved: 1 })),
    );

    await handler.handle({ fileIds: FILE_IDS }, META);

    const logs = records.filter(
      (record) => record.category.join('.') === 'event.media.relocation',
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('info');
    expect(logs[0]?.properties).toEqual({ files: 2, moved: 1 });
  });

  test('保存先をそろえる処理の失敗は、メッセージ全体を再試行させるため例外のまま投げる', async () => {
    const failure = new Error('R2の障害');
    const handler: MessageHandler<RelocateFilesBody> = new RelocateFilesHandler(
      createRelocator(() => Promise.reject(failure)),
    );

    const caught = await handler
      .handle({ fileIds: FILE_IDS }, META)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });
});
