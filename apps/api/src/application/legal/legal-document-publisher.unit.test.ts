import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  LegalDocumentState,
  LegalDraftSnapshot,
  LegalVersionSnapshot,
} from '../../domain/legal/legal-document.ts';
import type {
  AdminLegalDocumentView,
  LegalDocumentAdminReader,
} from './legal-document-admin-reader.ts';
import {
  type LegalDocumentPublisher,
  StoreLegalDocumentPublisher,
} from './legal-document-publisher.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type { LegalDocumentStore, LegalPublishInput } from './ports.ts';

const ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';
const OTHER_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRT';
const VERSION_ID = '01JC0000000000000000000099';
const NOW = new Date('2027-03-01T09:00:00.000Z');
const STATE_VERSION = 9;
const CHANGE_SUMMARY = '第5条の免責の範囲を明確化';
const LATEST_BODY = '# 利用規約\n\n第2版の本文';
const DRAFT_BODY = '# 利用規約\n\n第3版にする下書きの本文';
const CONFLICT_MESSAGE =
  '他の管理者がこの文書を更新しました。最新の内容を読み込んでから、もう一度操作してください。';

const LATEST: LegalVersionSnapshot = {
  versionNumber: 2,
  body: LATEST_BODY,
  publishedAt: new Date('2027-01-10T00:00:00.000Z'),
};

const DRAFT: LegalDraftSnapshot = {
  body: DRAFT_BODY,
  savedAt: new Date('2027-02-01T00:00:00.000Z'),
  savedByAdminId: OTHER_ADMIN_ID,
};

const fixedClock: Clock = { now: () => new Date(NOW) };

interface FakeOptions {
  readonly latest?: LegalVersionSnapshot | null;
  readonly draft?: LegalDraftSnapshot | null;
  readonly writeResult?: 'conflict';
  readonly clock?: Clock;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const publishes: LegalPublishInput[] = [];
  const generatedIds: string[] = [];
  let stateVersion = STATE_VERSION;
  const state = (kind: LegalDocumentKind): LegalDocumentState => ({
    kind,
    stateVersion: STATE_VERSION,
    latest: options.latest === undefined ? LATEST : options.latest,
    draft: options.draft === undefined ? DRAFT : options.draft,
  });
  const store: LegalDocumentStore = {
    findState: (kind) => {
      calls.push(`findState:${kind}`);
      return Promise.resolve(state(kind));
    },
    listSummaries: () => Promise.reject(new Error('一覧は呼ばれない想定です')),
    listRevisions: () =>
      Promise.reject(new Error('改訂履歴は呼ばれない想定です')),
    findVersion: () =>
      Promise.reject(new Error('版の照会は呼ばれない想定です')),
    findPublishedAt: () =>
      Promise.reject(new Error('日時による版の特定は呼ばれない想定です')),
    saveDraft: () => Promise.reject(new Error('保存は呼ばれない想定です')),
    discardDraft: () => Promise.reject(new Error('破棄は呼ばれない想定です')),
    publish: (input) => {
      calls.push('publish');
      publishes.push(input);
      if (options.writeResult === 'conflict') {
        return Promise.resolve('conflict');
      }
      stateVersion += 1;
      return Promise.resolve('published');
    },
  };
  const adminReader: LegalDocumentAdminReader = {
    listDocuments: () => Promise.reject(new Error('一覧は呼ばれない想定です')),
    getDocument: (kind) => {
      calls.push(`getDocument:${kind}`);
      return Promise.resolve(documentView(kind, stateVersion));
    },
    getVersion: () => Promise.reject(new Error('版の照会は呼ばれない想定です')),
  };
  const idGenerator: IdGenerator = {
    generate: () => {
      generatedIds.push(VERSION_ID);
      return VERSION_ID;
    },
  };
  const clock = options.clock ?? fixedClock;
  const publisher = new StoreLegalDocumentPublisher(
    store,
    adminReader,
    clock,
    idGenerator,
  );
  return {
    publisher,
    store,
    adminReader,
    idGenerator,
    clock,
    calls,
    publishes,
    generatedIds,
  };
}

function documentView(
  kind: LegalDocumentKind,
  stateVersion: number,
): AdminLegalDocumentView {
  return {
    kind,
    stateVersion,
    latestBody: DRAFT_BODY,
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

const publishInput = (
  overrides: Partial<{ expectedStateVersion: number }> = {},
) => ({
  adminId: ADMIN_ID,
  kind: 'terms' as const,
  expectedStateVersion: overrides.expectedStateVersion ?? STATE_VERSION,
  changeSummary: CHANGE_SUMMARY,
});

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

describe('StoreLegalDocumentPublisher.publish', () => {
  test('版のID・変更概要・公開日時・公開者で公開し、公開の後の編集用の状態を返す', async () => {
    const { publisher, calls, publishes } = setup();

    const document = await publisher.publish(publishInput());

    expect(publishes).toStrictEqual([
      {
        kind: 'terms',
        expectedStateVersion: STATE_VERSION,
        versionId: VERSION_ID,
        changeSummary: CHANGE_SUMMARY,
        publishedAt: NOW,
        publishedByAdminId: ADMIN_ID,
      },
    ]);
    expect(calls).toEqual(['findState:terms', 'publish', 'getDocument:terms']);
    expect(document).toStrictEqual(documentView('terms', STATE_VERSION + 1));
  });

  test('時計が最新版の公開日時以前に戻っていれば、公開日時を最新版の公開日時の1ミリ秒後にする', async () => {
    const { publisher, publishes } = setup({
      clock: { now: () => new Date(LATEST.publishedAt.getTime() - 5000) },
    });

    await publisher.publish(publishInput());

    expect(publishes[0]?.publishedAt).toEqual(
      new Date(LATEST.publishedAt.getTime() + 1),
    );
  });

  test('未公開の文書は、下書きがあれば現在の時刻を公開日時にして初版を公開する', async () => {
    const { publisher, publishes } = setup({ latest: null });

    await publisher.publish(publishInput());

    expect(publishes[0]?.publishedAt).toEqual(NOW);
  });

  test('状態の版が一致しなければ、公開せずにlegal_document_conflictで拒否する', async () => {
    const { publisher, calls, generatedIds } = setup();

    const error = await rejectionOf(
      publisher.publish(
        publishInput({ expectedStateVersion: STATE_VERSION - 1 }),
      ),
    );

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('legal_document_conflict');
    expect(error.message).toBe(CONFLICT_MESSAGE);
    expect(calls).toEqual(['findState:terms']);
    expect(generatedIds).toEqual([]);
  });

  test('下書きが無ければ、公開せずにlegal_document_draft_missingで拒否する', async () => {
    const { publisher, calls } = setup({ draft: null });

    const error = await rejectionOf(publisher.publish(publishInput()));

    expect(error.kind).toBe('unprocessable');
    expect(error.code).toBe('legal_document_draft_missing');
    expect(error.message).toBe('公開する下書きがありません。');
    expect(calls).toEqual(['findState:terms']);
  });

  test('下書きの本文が最新版の本文と同じなら、公開せずにlegal_document_unchangedで拒否する', async () => {
    const { publisher, calls } = setup({
      draft: { ...DRAFT, body: LATEST_BODY },
    });

    const error = await rejectionOf(publisher.publish(publishInput()));

    expect(error.kind).toBe('unprocessable');
    expect(error.code).toBe('legal_document_unchanged');
    expect(error.message).toBe('公開中の版から本文が変更されていません。');
    expect(calls).toEqual(['findState:terms']);
  });

  test('ストアの書き込みが競合すれば、legal_document_conflictで拒否して状態を照会しない', async () => {
    const { publisher, calls } = setup({ writeResult: 'conflict' });

    const error = await rejectionOf(publisher.publish(publishInput()));

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('legal_document_conflict');
    expect(error.message).toBe(CONFLICT_MESSAGE);
    expect(calls).toEqual(['findState:terms', 'publish']);
  });
});

describe('StoreLegalDocumentPublisher のログ', () => {
  test('公開の結果を種類・公開した版番号・管理者のID・競合の有無で記録し、本文と変更概要を属性に入れない', async () => {
    const { publisher } = setup();

    await publisher.publish(publishInput());

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('info');
    expect(logs[0]?.category).toEqual(['api', 'legal']);
    expect(logs[0]?.properties).toStrictEqual({
      action: 'publish',
      kind: 'terms',
      versionNumber: 3,
      adminId: ADMIN_ID,
      conflict: false,
    });
  });

  test('ストアの競合による拒否を競合ありとして記録する', async () => {
    const { publisher } = setup({ writeResult: 'conflict', latest: null });

    await rejectionOf(publisher.publish(publishInput()));

    expect(logs.map((log) => log.properties)).toStrictEqual([
      {
        action: 'publish',
        kind: 'terms',
        versionNumber: 1,
        adminId: ADMIN_ID,
        conflict: true,
      },
    ]);
  });

  test('下書きなし・変更なしの拒否は記録しない', async () => {
    const { publisher } = setup({ draft: null });

    await rejectionOf(publisher.publish(publishInput()));

    expect(logs).toEqual([]);
  });
});

describe('StoreLegalDocumentPublisher の依存性注入', () => {
  test('ストア・管理の照会・時計・ID生成を束縛の識別子で受け取って解決できる', async () => {
    const { store, adminReader, idGenerator, publishes } = setup();
    const container = new Container();
    container
      .bind<LegalDocumentStore>(LEGAL_TYPES.LegalDocumentStore)
      .toConstantValue(store);
    container
      .bind<LegalDocumentAdminReader>(LEGAL_TYPES.LegalDocumentAdminReader)
      .toConstantValue(adminReader);
    container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(fixedClock);
    container
      .bind<IdGenerator>(PLATFORM_TYPES.IdGenerator)
      .toConstantValue(idGenerator);
    container
      .bind<LegalDocumentPublisher>(LEGAL_TYPES.LegalDocumentPublisher)
      .to(StoreLegalDocumentPublisher);

    const publisher = container.get<LegalDocumentPublisher>(
      LEGAL_TYPES.LegalDocumentPublisher,
    );
    await publisher.publish(publishInput());

    expect(publishes[0]?.versionId).toBe(VERSION_ID);
    expect(publishes[0]?.publishedAt).toEqual(NOW);
  });
});
