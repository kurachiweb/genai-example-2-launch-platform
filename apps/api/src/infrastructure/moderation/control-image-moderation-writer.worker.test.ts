import { beforeEach, describe, expect, test } from 'vitest';

import type { ModerationAction } from '../../../common-lib/moderation/moderation-actions.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { QuarantineReason } from '../../../lib/core/media/media-file.ts';
import {
  after,
  fileIdOf,
  insertFile,
  insertReason,
  readFile,
  readReasons,
} from '../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  createModerationControl,
  type ModerationControlParts,
  OPERATED_AT,
  racingFileStore,
} from '../../../lib/workers/media/testing/media-moderation-control-fixtures.ts';
import {
  clearMediaState,
  putObject,
} from '../../../lib/workers/media/testing/media-operations-fixtures.ts';
import {
  createHookedQueue,
  failingFromAttempt,
  relocateMessagesOf,
} from '../../../lib/workers/media/testing/media-quarantine-fixtures.ts';
import { D1ModerationRecordStore } from '../../../lib/workers/moderation/d1-moderation-record-store.ts';
import {
  db,
  moderationIdOf,
  newRecordOf,
  readModerationRows,
} from '../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import type {
  ImageModerationChange,
  ImageModerationWrite,
  ImageModerationWriter,
} from '../../application/moderation/ports.ts';
import { ControlImageModerationWriter } from './control-image-moderation-writer.ts';
import { D1ModerationStatements } from './d1-moderation-statements.ts';
import {
  auditLogIdOf,
  auditOf,
  clearModerationWrites,
  readModerationAuditLogs,
} from './testing/moderation-write-fixtures.ts';

const FILE = 1;
const MISSING = 99;
const REASON = '不適切な画像のため';

interface Case {
  readonly name: string;
  readonly action: ModerationAction;
  readonly run: (
    writer: ImageModerationWriter,
    write: ImageModerationWrite,
  ) => Promise<ImageModerationChange>;
  readonly seed: () => Promise<void>;
  readonly seedUnchanged: () => Promise<void>;
  readonly expectChanged: () => Promise<void>;
}

async function reasonsOf(index: number): Promise<QuarantineReason[]> {
  return (await readReasons())
    .filter((row) => row.fileId === fileIdOf(index))
    .map((row) => row.reason);
}

async function seedQuarantined(reason: QuarantineReason): Promise<void> {
  await insertFile(FILE, { location: 'quarantine' });
  await insertReason(FILE, reason);
}

const CASES: readonly Case[] = [
  {
    name: '個別の隔離(addReason)',
    action: 'image.quarantine',
    run: (writer, write) => writer.addReason(write, 'admin_action'),
    seed: () => insertFile(FILE),
    seedUnchanged: () => seedQuarantined('admin_action'),
    expectChanged: async () => {
      expect(await reasonsOf(FILE)).toStrictEqual(['admin_action']);
    },
  },
  {
    name: '公開承認(removeReason)',
    action: 'image.approve',
    run: (writer, write) => writer.removeReason(write, 'auto'),
    seed: () => seedQuarantined('auto'),
    seedUnchanged: () => insertFile(FILE),
    expectChanged: async () => {
      expect(await reasonsOf(FILE)).toStrictEqual([]);
    },
  },
  {
    name: '隔離の解除(removeReason)',
    action: 'image.release',
    run: (writer, write) => writer.removeReason(write, 'admin_action'),
    seed: () => seedQuarantined('admin_action'),
    seedUnchanged: () => insertFile(FILE),
    expectChanged: async () => {
      expect(await reasonsOf(FILE)).toStrictEqual([]);
    },
  },
  {
    name: '削除(requestErase)',
    action: 'image.delete',
    run: (writer, write) => writer.requestErase(write),
    seed: async () => {
      await seedQuarantined('auto');
      await putObject('quarantine', FILE);
    },
    seedUnchanged: () =>
      insertFile(FILE, { location: 'quarantine', eraseRequestedAt: after(0) }),
    expectChanged: async () => {
      expect(await readFile(FILE)).toBeUndefined();
    },
  },
];

function createWriter(parts: ModerationControlParts = {}): {
  readonly writer: ImageModerationWriter;
  readonly sent: ReturnType<typeof createModerationControl>['sent'];
} {
  const { control, sent } = createModerationControl(parts);
  return {
    writer: new ControlImageModerationWriter(
      new D1ModerationStatements(db, new D1ModerationRecordStore(db)),
      control,
    ),
    sent,
  };
}

function writeOf(
  action: ModerationAction,
  fileId: string = fileIdOf(FILE),
): ImageModerationWrite {
  return {
    fileId,
    record: newRecordOf(1, {
      action,
      targetId: fileId,
      reason: REASON,
      occurredAt: OPERATED_AT,
    }),
    audit: auditOf({
      index: 1,
      action,
      targetKind: 'image',
      targetId: fileId,
      occurredAt: OPERATED_AT,
      reason: REASON,
    }),
  };
}

async function expectNothingRecorded(): Promise<void> {
  expect(await readModerationRows()).toStrictEqual([]);
  expect(await readModerationAuditLogs()).toStrictEqual([]);
}

beforeEach(async () => {
  await clearModerationWrites();
  await clearMediaState();
});

describe.each(CASES)('ControlImageModerationWriterの$name', (testCase) => {
  test('記録と監査ログを媒体の状態の変更と同じ一括の書き込みで確定し、changedを返す', async () => {
    await testCase.seed();
    const { writer } = createWriter();

    const result = await testCase.run(writer, writeOf(testCase.action));

    expect(result).toBe('changed');
    await testCase.expectChanged();
    expect(await readModerationRows()).toStrictEqual([
      expect.objectContaining({
        id: moderationIdOf(1),
        action: testCase.action,
        targetKind: 'image',
        targetId: fileIdOf(FILE),
        reason: REASON,
        occurredAt: OPERATED_AT,
      }),
    ]);
    expect(await readModerationAuditLogs()).toStrictEqual([
      expect.objectContaining({
        id: auditLogIdOf(1),
        action: testCase.action,
        reason: REASON,
        targets: [{ targetKind: 'image', targetId: fileIdOf(FILE) }],
      }),
    ]);
  });

  test('既に目的の状態ならunchangedを返し、記録と監査ログを残さない', async () => {
    await testCase.seedUnchanged();
    const { writer } = createWriter();

    const result = await testCase.run(writer, writeOf(testCase.action));

    expect(result).toBe('unchanged');
    await expectNothingRecorded();
  });

  test('対象のファイルが無ければnot-foundを返し、記録と監査ログを残さない', async () => {
    const { writer } = createWriter();

    const result = await testCase.run(
      writer,
      writeOf(testCase.action, fileIdOf(MISSING)),
    );

    expect(result).toBe('not-found');
    await expectNothingRecorded();
  });
});

describe('ControlImageModerationWriterの失敗と競合', () => {
  test('移動の依頼に失敗するとstorage_unavailableを投げ、理由の変更と記録と監査ログは確定したまま残す', async () => {
    await insertFile(FILE);
    const hooked = createHookedQueue(
      failingFromAttempt(1, new Error('障害を再現する')),
    );
    const { writer } = createWriter({ queue: hooked.queue });

    const error: unknown = await writer
      .addReason(writeOf('image.quarantine'), 'admin_action')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'storage_unavailable' });
    expect(await reasonsOf(FILE)).toStrictEqual(['admin_action']);
    expect(await readModerationRows()).toHaveLength(1);
    expect(await readModerationAuditLogs()).toHaveLength(1);
  });

  test('移動の依頼の失敗の後の再実行は移動を依頼し直してunchangedを返し、記録と監査ログを重ねない', async () => {
    await insertFile(FILE);
    const failing = createHookedQueue(
      failingFromAttempt(1, new Error('障害を再現する')),
    );
    await createWriter({ queue: failing.queue })
      .writer.addReason(writeOf('image.quarantine'), 'admin_action')
      .catch(() => undefined);
    const { writer, sent } = createWriter();

    const result = await writer.addReason(
      {
        ...writeOf('image.quarantine'),
        record: newRecordOf(2, {
          action: 'image.quarantine',
          targetId: fileIdOf(FILE),
          reason: REASON,
          occurredAt: OPERATED_AT,
        }),
        audit: auditOf({
          index: 2,
          action: 'image.quarantine',
          targetKind: 'image',
          targetId: fileIdOf(FILE),
          occurredAt: OPERATED_AT,
          reason: REASON,
        }),
      },
      'admin_action',
    );

    expect(result).toBe('unchanged');
    expect(relocateMessagesOf(sent)).toStrictEqual([[fileIdOf(FILE)]]);
    expect((await readModerationRows()).map(({ id }) => id)).toStrictEqual([
      moderationIdOf(1),
    ]);
    expect(await readModerationAuditLogs()).toHaveLength(1);
  });

  test('即時の削除に失敗するとstorage_unavailableを投げ、削除待ちの印と記録と監査ログは確定したまま残す', async () => {
    await seedQuarantined('auto');
    const { writer } = createWriter({
      eraser: { erase: () => Promise.reject(new Error('障害を再現する')) },
    });

    const error: unknown = await writer
      .requestErase(writeOf('image.delete'))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'storage_unavailable' });
    expect((await readFile(FILE))?.eraseRequestedAt).toStrictEqual(OPERATED_AT);
    expect(await readModerationRows()).toHaveLength(1);
    expect(await readModerationAuditLogs()).toHaveLength(1);
  });

  test('読み取りの後に別の操作が同じ理由を外すと、記録と監査ログごと取り消してunchangedを返す', async () => {
    await seedQuarantined('admin_action');
    await insertReason(FILE, 'auto');
    const { writer } = createWriter({
      files: racingFileStore(async () => {
        const { control } = createModerationControl();
        await control.removeReason({
          fileId: fileIdOf(FILE),
          reason: 'admin_action',
          statements: [],
        });
      }),
    });

    const result = await writer.removeReason(
      writeOf('image.release'),
      'admin_action',
    );

    expect(result).toBe('unchanged');
    expect(await reasonsOf(FILE)).toStrictEqual(['auto']);
    await expectNothingRecorded();
  });
});
