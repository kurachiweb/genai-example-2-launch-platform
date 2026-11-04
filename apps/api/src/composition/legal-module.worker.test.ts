import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { inject, injectable } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { LEGAL_DOCUMENT_KINDS } from '../../common-lib/legal/legal-documents.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  type LegalDocumentAdminReader,
  StoreLegalDocumentAdminReader,
} from '../application/legal/legal-document-admin-reader.ts';
import {
  type LegalDocumentPublisher,
  StoreLegalDocumentPublisher,
} from '../application/legal/legal-document-publisher.ts';
import {
  type LegalDocumentReader,
  StoreLegalDocumentReader,
} from '../application/legal/legal-document-reader.ts';
import {
  type LegalDraftEditor,
  StoreLegalDraftEditor,
} from '../application/legal/legal-draft-editor.ts';
import { LEGAL_TYPES } from '../application/legal/legal-types.ts';
import {
  type LegalVersionLocator,
  StoreLegalVersionLocator,
} from '../application/legal/legal-version-locator.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import { D1LegalDocumentStore } from '../infrastructure/legal/d1-legal-document-store.ts';
import { resetLegalTables } from '../infrastructure/legal/testing/legal-store-fixtures.ts';
import { MODULES } from './modules.ts';

const EDITOR = 1;

function createContainer() {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

// 後続specの部品と同じく、照会口を識別子で注入するクラス
@injectable()
class ConsentVersionConsumer {
  constructor(
    @inject(LEGAL_TYPES.LegalVersionLocator)
    readonly locator: LegalVersionLocator,
  ) {}
}

beforeEach(async () => {
  await clearAdminTables();
  await resetLegalTables();
});

describe('APIサーバーの法務文書の束縛', () => {
  test.each([
    [
      'LegalDocumentStore',
      LEGAL_TYPES.LegalDocumentStore,
      D1LegalDocumentStore,
    ],
    [
      'LegalDocumentReader',
      LEGAL_TYPES.LegalDocumentReader,
      StoreLegalDocumentReader,
    ],
    [
      'LegalDocumentAdminReader',
      LEGAL_TYPES.LegalDocumentAdminReader,
      StoreLegalDocumentAdminReader,
    ],
    ['LegalDraftEditor', LEGAL_TYPES.LegalDraftEditor, StoreLegalDraftEditor],
    [
      'LegalDocumentPublisher',
      LEGAL_TYPES.LegalDocumentPublisher,
      StoreLegalDocumentPublisher,
    ],
    [
      'LegalVersionLocator',
      LEGAL_TYPES.LegalVersionLocator,
      StoreLegalVersionLocator,
    ],
  ] as const)(
    '処理単位のコンテナから%sを解決する',
    (_name, identifier, implementation) => {
      expect(createContainer().get(identifier)).toBeInstanceOf(implementation);
    },
  );

  test('後続specの部品は版の特定の照会口を識別子で注入して受け取れる', () => {
    const container = createContainer();
    container.bind(ConsentVersionConsumer).toSelf();

    expect(container.get(ConsentVersionConsumer).locator).toBeInstanceOf(
      StoreLegalVersionLocator,
    );
  });

  test('公開の照会と管理の照会は初期データの未公開の文書を返す', async () => {
    const container = createContainer();
    const reader = container.get<LegalDocumentReader>(
      LEGAL_TYPES.LegalDocumentReader,
    );
    const adminReader = container.get<LegalDocumentAdminReader>(
      LEGAL_TYPES.LegalDocumentAdminReader,
    );

    await expect(reader.getDocument('terms')).resolves.toEqual({
      kind: 'terms',
      latest: null,
      revisions: [],
    });
    const summaries = await adminReader.listDocuments();
    expect(summaries.map(({ kind }) => kind).toSorted()).toEqual(
      [...LEGAL_DOCUMENT_KINDS].toSorted(),
    );
    expect(
      summaries.every(
        (summary) =>
          summary.latestVersionNumber === null &&
          summary.latestPublishedAt === null &&
          !summary.hasDraft,
      ),
    ).toBe(true);
  });

  test('束縛から取り出した保存と公開の後、公開の照会と同意日時からの版の特定が公開した版を返す', async () => {
    await insertAdmin(EDITOR);
    const adminId = adminIdOf(EDITOR);
    const container = createContainer();
    const adminReader = container.get<LegalDocumentAdminReader>(
      LEGAL_TYPES.LegalDocumentAdminReader,
    );
    const editor = container.get<LegalDraftEditor>(
      LEGAL_TYPES.LegalDraftEditor,
    );
    const publisher = container.get<LegalDocumentPublisher>(
      LEGAL_TYPES.LegalDocumentPublisher,
    );
    const { stateVersion } = await adminReader.getDocument('privacy');

    const saved = await editor.save({
      adminId,
      kind: 'privacy',
      expectedStateVersion: stateVersion,
      body: '# プライバシーポリシー',
    });
    const published = await publisher.publish({
      adminId,
      kind: 'privacy',
      expectedStateVersion: saved.stateVersion,
      changeSummary: '初版',
    });

    expect(saved.draft?.savedBy).toEqual({ id: adminId, nickname: '管理者1' });
    expect(published.draft).toBeNull();
    expect(published.revisions).toHaveLength(1);
    const [revision] = published.revisions;
    expect(revision?.publishedBy).toEqual({
      id: adminId,
      nickname: '管理者1',
    });
    const publishedAt = revision?.publishedAt ?? new Date(Number.NaN);
    const document = await createContainer()
      .get<LegalDocumentReader>(LEGAL_TYPES.LegalDocumentReader)
      .getDocument('privacy');
    expect(document.latest).toMatchObject({
      versionNumber: 1,
      body: '# プライバシーポリシー',
      changeSummary: '初版',
      isLatest: true,
    });
    const locator = createContainer().get<LegalVersionLocator>(
      LEGAL_TYPES.LegalVersionLocator,
    );
    await expect(
      locator.findPublishedAt('privacy', publishedAt),
    ).resolves.toEqual({ versionNumber: 1, publishedAt });
    await expect(
      locator.findPublishedAt('privacy', new Date(publishedAt.getTime() - 1)),
    ).resolves.toBeUndefined();
    await expect(
      locator.findPublishedAt('terms', publishedAt),
    ).resolves.toBeUndefined();
  });
});
