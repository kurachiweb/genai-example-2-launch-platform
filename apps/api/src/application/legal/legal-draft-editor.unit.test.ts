import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { LegalDocumentState } from '../../domain/legal/legal-document.ts';
import type {
  AdminLegalDocumentView,
  LegalDocumentAdminReader,
} from './legal-document-admin-reader.ts';
import {
  type LegalDraftEditor,
  StoreLegalDraftEditor,
} from './legal-draft-editor.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type {
  LegalDocumentStore,
  LegalDraftDiscardInput,
  LegalDraftSaveInput,
} from './ports.ts';

const ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';
const OTHER_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRT';
const NOW = new Date('2027-03-01T09:00:00.000Z');
const STATE_VERSION = 5;
const LATEST_BODY = '# 利用規約\n\n第2版の本文';
const DRAFT_BODY = '# 利用規約\n\n保存済みの下書きの本文';
const NEW_BODY = '# 利用規約\n\n新しく保存する本文';
const CONFLICT_MESSAGE =
  '他の管理者がこの文書を更新しました。最新の内容を読み込んでから、もう一度操作してください。';

const fixedClock: Clock = { now: () => new Date(NOW) };

interface FakeOptions {
  readonly hasDraft?: boolean;
  readonly writeResult?: 'conflict';
}

function initialState(
  kind: LegalDocumentKind,
  hasDraft: boolean,
): LegalDocumentState {
  return {
    kind,
    stateVersion: STATE_VERSION,
    latest: {
      versionNumber: 2,
      body: LATEST_BODY,
      publishedAt: new Date('2027-01-10T00:00:00.000Z'),
    },
    draft: hasDraft
      ? {
          body: DRAFT_BODY,
          savedAt: new Date('2027-02-01T00:00:00.000Z'),
          savedByAdminId: OTHER_ADMIN_ID,
        }
      : null,
  };
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const saves: LegalDraftSaveInput[] = [];
  const discards: LegalDraftDiscardInput[] = [];
  let stateVersion = STATE_VERSION;
  const store: LegalDocumentStore = {
    findState: (kind) => {
      calls.push(`findState:${kind}`);
      return Promise.resolve(initialState(kind, options.hasDraft ?? true));
    },
    listSummaries: () => Promise.reject(new Error('一覧は呼ばれない想定です')),
    listRevisions: () =>
      Promise.reject(new Error('改訂履歴は呼ばれない想定です')),
    findVersion: () =>
      Promise.reject(new Error('版の照会は呼ばれない想定です')),
    findPublishedAt: () =>
      Promise.reject(new Error('日時による版の特定は呼ばれない想定です')),
    saveDraft: (input) => {
      calls.push('saveDraft');
      saves.push(input);
      if (options.writeResult === 'conflict') {
        return Promise.resolve('conflict');
      }
      stateVersion += 1;
      return Promise.resolve('saved');
    },
    discardDraft: (input) => {
      calls.push('discardDraft');
      discards.push(input);
      if (options.writeResult === 'conflict') {
        return Promise.resolve('conflict');
      }
      stateVersion += 1;
      return Promise.resolve('discarded');
    },
    publish: () => Promise.reject(new Error('公開は呼ばれない想定です')),
  };
  const adminReader: LegalDocumentAdminReader = {
    listDocuments: () => Promise.reject(new Error('一覧は呼ばれない想定です')),
    getDocument: (kind) => {
      calls.push(`getDocument:${kind}`);
      return Promise.resolve(documentView(kind, stateVersion));
    },
    getVersion: () => Promise.reject(new Error('版の照会は呼ばれない想定です')),
  };
  const editor = new StoreLegalDraftEditor(store, adminReader, fixedClock);
  return { editor, store, adminReader, calls, saves, discards };
}

function documentView(
  kind: LegalDocumentKind,
  stateVersion: number,
): AdminLegalDocumentView {
  return {
    kind,
    stateVersion,
    latestBody: LATEST_BODY,
    draft: null,
    revisions: [],
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) {
    throw new Error('AppErrorで拒否される想定です', { cause: error });
  }
  return error;
}

let logs: LogRecord[] = [];

beforeEach(() => {
  logs = [];
  configureSync({
    reset: true,
    sinks: { memory: (record) => logs.push(record) },
    loggers: [
      { category: ['api', 'legal'], sinks: ['memory'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('StoreLegalDraftEditor.save', () => {
  test('状態の版が一致すれば、本文・保存日時・保存者で下書きを保存し、保存の後の編集用の状態を返す', async () => {
    const { editor, calls, saves } = setup();

    const document = await editor.save({
      adminId: ADMIN_ID,
      kind: 'terms',
      expectedStateVersion: STATE_VERSION,
      body: NEW_BODY,
    });

    expect(saves).toStrictEqual([
      {
        kind: 'terms',
        expectedStateVersion: STATE_VERSION,
        body: NEW_BODY,
        savedAt: NOW,
        savedByAdminId: ADMIN_ID,
      },
    ]);
    expect(calls).toEqual([
      'findState:terms',
      'saveDraft',
      'getDocument:terms',
    ]);
    expect(document).toStrictEqual(documentView('terms', STATE_VERSION + 1));
  });

  test('下書きが無い文書にも下書きを作成する', async () => {
    const { editor, saves } = setup({ hasDraft: false });

    const document = await editor.save({
      adminId: ADMIN_ID,
      kind: 'privacy',
      expectedStateVersion: STATE_VERSION,
      body: NEW_BODY,
    });

    expect(saves).toHaveLength(1);
    expect(document.stateVersion).toBe(STATE_VERSION + 1);
  });

  test('状態の版が一致しなければ、保存せずにlegal_document_conflictで拒否する', async () => {
    const { editor, calls } = setup();

    const error = await rejectionOf(
      editor.save({
        adminId: ADMIN_ID,
        kind: 'terms',
        expectedStateVersion: STATE_VERSION - 1,
        body: NEW_BODY,
      }),
    );

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('legal_document_conflict');
    expect(error.message).toBe(CONFLICT_MESSAGE);
    expect(calls).toEqual(['findState:terms']);
  });

  test('ストアの書き込みが競合すれば、legal_document_conflictで拒否して状態を照会しない', async () => {
    const { editor, calls } = setup({ writeResult: 'conflict' });

    const error = await rejectionOf(
      editor.save({
        adminId: ADMIN_ID,
        kind: 'terms',
        expectedStateVersion: STATE_VERSION,
        body: NEW_BODY,
      }),
    );

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('legal_document_conflict');
    expect(error.message).toBe(CONFLICT_MESSAGE);
    expect(calls).toEqual(['findState:terms', 'saveDraft']);
  });
});

describe('StoreLegalDraftEditor.discard', () => {
  test('状態の版が一致し下書きがあれば、下書きを破棄して破棄の後の編集用の状態を返す', async () => {
    const { editor, calls, discards } = setup();

    const document = await editor.discard({
      adminId: ADMIN_ID,
      kind: 'legal-notice',
      expectedStateVersion: STATE_VERSION,
    });

    expect(discards).toStrictEqual([
      { kind: 'legal-notice', expectedStateVersion: STATE_VERSION },
    ]);
    expect(calls).toEqual([
      'findState:legal-notice',
      'discardDraft',
      'getDocument:legal-notice',
    ]);
    expect(document).toStrictEqual(
      documentView('legal-notice', STATE_VERSION + 1),
    );
  });

  test('状態の版が一致しなければ、破棄せずにlegal_document_conflictで拒否する', async () => {
    const { editor, calls } = setup();

    const error = await rejectionOf(
      editor.discard({
        adminId: ADMIN_ID,
        kind: 'terms',
        expectedStateVersion: STATE_VERSION + 1,
      }),
    );

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('legal_document_conflict');
    expect(calls).toEqual(['findState:terms']);
  });

  test('状態の版が一致しなければ、下書きが無くても下書きなしより競合を優先して拒否する', async () => {
    const { editor } = setup({ hasDraft: false });

    const error = await rejectionOf(
      editor.discard({
        adminId: ADMIN_ID,
        kind: 'terms',
        expectedStateVersion: STATE_VERSION + 1,
      }),
    );

    expect(error.code).toBe('legal_document_conflict');
  });

  test('下書きが無ければ、破棄せずにlegal_document_draft_missingで拒否する', async () => {
    const { editor, calls } = setup({ hasDraft: false });

    const error = await rejectionOf(
      editor.discard({
        adminId: ADMIN_ID,
        kind: 'terms',
        expectedStateVersion: STATE_VERSION,
      }),
    );

    expect(error.kind).toBe('unprocessable');
    expect(error.code).toBe('legal_document_draft_missing');
    expect(error.message).toBe('公開する下書きがありません。');
    expect(calls).toEqual(['findState:terms']);
  });

  test('ストアの書き込みが競合すれば、legal_document_conflictで拒否して状態を照会しない', async () => {
    const { editor, calls } = setup({ writeResult: 'conflict' });

    const error = await rejectionOf(
      editor.discard({
        adminId: ADMIN_ID,
        kind: 'terms',
        expectedStateVersion: STATE_VERSION,
      }),
    );

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('legal_document_conflict');
    expect(calls).toEqual(['findState:terms', 'discardDraft']);
  });
});

describe('StoreLegalDraftEditor のログ', () => {
  test('保存の結果を種類・最新の版番号・管理者のID・競合の有無で記録し、本文を属性に入れない', async () => {
    const { editor } = setup();

    await editor.save({
      adminId: ADMIN_ID,
      kind: 'terms',
      expectedStateVersion: STATE_VERSION,
      body: NEW_BODY,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('info');
    expect(logs[0]?.category).toEqual(['api', 'legal']);
    expect(logs[0]?.properties).toStrictEqual({
      action: 'save',
      kind: 'terms',
      latestVersionNumber: 2,
      adminId: ADMIN_ID,
      conflict: false,
    });
  });

  test('競合による拒否を競合ありとして記録する', async () => {
    const { editor } = setup({ writeResult: 'conflict' });

    await rejectionOf(
      editor.discard({
        adminId: ADMIN_ID,
        kind: 'privacy',
        expectedStateVersion: STATE_VERSION,
      }),
    );

    expect(logs.map((log) => log.properties)).toStrictEqual([
      {
        action: 'discard',
        kind: 'privacy',
        latestVersionNumber: 2,
        adminId: ADMIN_ID,
        conflict: true,
      },
    ]);
  });

  test('状態の版の不一致による拒否も競合ありとして記録する', async () => {
    const { editor } = setup();

    await rejectionOf(
      editor.save({
        adminId: ADMIN_ID,
        kind: 'terms',
        expectedStateVersion: STATE_VERSION - 1,
        body: NEW_BODY,
      }),
    );

    expect(logs.map((log) => log.properties)).toStrictEqual([
      {
        action: 'save',
        kind: 'terms',
        latestVersionNumber: 2,
        adminId: ADMIN_ID,
        conflict: true,
      },
    ]);
  });
});

describe('StoreLegalDraftEditor の依存性注入', () => {
  test('ストア・管理の照会・時計を束縛の識別子で受け取って解決できる', async () => {
    const { store, adminReader, saves } = setup();
    const container = new Container();
    container
      .bind<LegalDocumentStore>(LEGAL_TYPES.LegalDocumentStore)
      .toConstantValue(store);
    container
      .bind<LegalDocumentAdminReader>(LEGAL_TYPES.LegalDocumentAdminReader)
      .toConstantValue(adminReader);
    container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(fixedClock);
    container
      .bind<LegalDraftEditor>(LEGAL_TYPES.LegalDraftEditor)
      .to(StoreLegalDraftEditor);

    const editor = container.get<LegalDraftEditor>(
      LEGAL_TYPES.LegalDraftEditor,
    );
    await editor.save({
      adminId: ADMIN_ID,
      kind: 'terms',
      expectedStateVersion: STATE_VERSION,
      body: NEW_BODY,
    });

    expect(saves[0]?.savedAt).toEqual(NOW);
  });
});
