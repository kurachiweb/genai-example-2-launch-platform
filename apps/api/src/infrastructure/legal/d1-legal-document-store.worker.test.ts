import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { createDatabase } from '../../../db/client.ts';
import { legalDocumentVersions } from '../../../db/schema/legal/legal-document-versions.ts';
import { legalDocuments } from '../../../db/schema/legal/legal-documents.ts';
import type {
  LegalDocumentStore,
  LegalPublishInput,
} from '../../application/legal/ports.ts';
import { D1LegalDocumentStore } from './d1-legal-document-store.ts';
import {
  resetLegalTables,
  SEEDED_DOCUMENTS,
} from './testing/legal-store-fixtures.ts';

const db = createDatabase(env.DB);

const T0 = new Date('2026-11-05T00:00:00.000Z');

const ADMIN_A = '01JC0ADMN00000000000000001';

const ADMIN_B = '01JC0ADMN00000000000000002';

function after(milliseconds: number): Date {
  return new Date(T0.getTime() + milliseconds);
}

function versionIdOf(index: number): string {
  return `01JC0VERS${String(index).padStart(17, '0')}`;
}

function createStore(): LegalDocumentStore {
  return new D1LegalDocumentStore(db);
}

async function readDocumentRow(kind: LegalDocumentKind) {
  const [row] = await db
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.kind, kind));
  return row;
}

async function readAllDocumentRows() {
  return db.select().from(legalDocuments).orderBy(asc(legalDocuments.id));
}

async function readAllVersionRows() {
  return db
    .select()
    .from(legalDocumentVersions)
    .orderBy(
      asc(legalDocumentVersions.documentId),
      asc(legalDocumentVersions.versionNumber),
    );
}

async function stateVersionOf(kind: LegalDocumentKind): Promise<number> {
  return (await createStore().findState(kind)).stateVersion;
}

async function saveDraft(
  kind: LegalDocumentKind,
  body: string,
  savedAt: Date = T0,
): Promise<void> {
  const result = await createStore().saveDraft({
    kind,
    expectedStateVersion: await stateVersionOf(kind),
    body,
    savedAt,
    savedByAdminId: ADMIN_A,
  });
  expect(result).toBe('saved');
}

function publishInputOf(
  kind: LegalDocumentKind,
  expectedStateVersion: number,
  overrides: Partial<LegalPublishInput> = {},
): LegalPublishInput {
  return {
    kind,
    expectedStateVersion,
    versionId: versionIdOf(1),
    changeSummary: '初版を公開',
    publishedAt: after(1_000),
    publishedByAdminId: ADMIN_B,
    ...overrides,
  };
}

async function publishDraft(
  kind: LegalDocumentKind,
  body: string,
  input: Partial<LegalPublishInput> = {},
): Promise<void> {
  await saveDraft(kind, body);
  const result = await createStore().publish(
    publishInputOf(kind, await stateVersionOf(kind), input),
  );
  expect(result).toBe('published');
}

beforeEach(async () => {
  await resetLegalTables();
});

describe('D1LegalDocumentStore.findState', () => {
  test.each(SEEDED_DOCUMENTS.map(({ kind }) => kind))(
    '初期データの%sは状態の版0で、最新版と下書きを持たない',
    async (kind) => {
      expect(await createStore().findState(kind)).toEqual({
        kind,
        stateVersion: 0,
        latest: null,
        draft: null,
      });
    },
  );

  test('最新の版番号の版の本文と公開日時と、下書きの本文・保存日時・保存した管理者を返す', async () => {
    await publishDraft('terms', '第1版', { publishedAt: after(1_000) });
    await publishDraft('terms', '第2版', {
      versionId: versionIdOf(2),
      publishedAt: after(2_000),
    });
    await saveDraft('terms', '第3版の下書き', after(3_000));

    expect(await createStore().findState('terms')).toEqual({
      kind: 'terms',
      stateVersion: 5,
      latest: { versionNumber: 2, body: '第2版', publishedAt: after(2_000) },
      draft: {
        body: '第3版の下書き',
        savedAt: after(3_000),
        savedByAdminId: ADMIN_A,
      },
    });
  });

  test('文書の行が無ければ例外を投げる', async () => {
    await db.delete(legalDocuments).where(eq(legalDocuments.kind, 'privacy'));

    await expect(createStore().findState('privacy')).rejects.toThrow('privacy');
  });
});

describe('D1LegalDocumentStore.listSummaries', () => {
  test('初期データの3文書を種類の表示順に、版と下書きの無い状態で返す', async () => {
    expect(await createStore().listSummaries()).toEqual([
      {
        kind: 'terms',
        latestVersionNumber: null,
        latestPublishedAt: null,
        hasDraft: false,
      },
      {
        kind: 'privacy',
        latestVersionNumber: null,
        latestPublishedAt: null,
        hasDraft: false,
      },
      {
        kind: 'legal-notice',
        latestVersionNumber: null,
        latestPublishedAt: null,
        hasDraft: false,
      },
    ]);
  });

  test('最新版の版番号と公開日時と、下書きの有無を文書ごとに返す', async () => {
    await publishDraft('privacy', '第1版', { publishedAt: after(1_000) });
    await publishDraft('privacy', '第2版', {
      versionId: versionIdOf(2),
      publishedAt: after(2_000),
    });
    await saveDraft('legal-notice', '下書き');

    expect(await createStore().listSummaries()).toEqual([
      {
        kind: 'terms',
        latestVersionNumber: null,
        latestPublishedAt: null,
        hasDraft: false,
      },
      {
        kind: 'privacy',
        latestVersionNumber: 2,
        latestPublishedAt: after(2_000),
        hasDraft: false,
      },
      {
        kind: 'legal-notice',
        latestVersionNumber: null,
        latestPublishedAt: null,
        hasDraft: true,
      },
    ]);
  });

  test('文書の行が欠けていれば例外を投げる', async () => {
    await db
      .delete(legalDocuments)
      .where(eq(legalDocuments.kind, 'legal-notice'));

    await expect(createStore().listSummaries()).rejects.toThrow('legal-notice');
  });
});

describe('D1LegalDocumentStore.saveDraft', () => {
  test('状態の版が一致すれば下書きを保存し、状態の版を1増やして更新日時を保存日時にする', async () => {
    const result = await createStore().saveDraft({
      kind: 'terms',
      expectedStateVersion: 0,
      body: '下書き',
      savedAt: after(500),
      savedByAdminId: ADMIN_A,
    });

    expect(result).toBe('saved');
    expect(await readDocumentRow('terms')).toMatchObject({
      stateVersion: 1,
      latestVersionNumber: 0,
      draftBody: '下書き',
      draftSavedAt: after(500),
      draftSavedByAdminId: ADMIN_A,
      updatedAt: after(500),
    });
  });

  test('下書きがあれば内容と保存者を上書きし、状態の版をさらに1増やす', async () => {
    await saveDraft('terms', '1回目');

    const result = await createStore().saveDraft({
      kind: 'terms',
      expectedStateVersion: 1,
      body: '2回目',
      savedAt: after(700),
      savedByAdminId: ADMIN_B,
    });

    expect(result).toBe('saved');
    expect(await createStore().findState('terms')).toMatchObject({
      stateVersion: 2,
      draft: { body: '2回目', savedAt: after(700), savedByAdminId: ADMIN_B },
    });
  });

  test.each([0, 2])(
    '状態の版が1の文書に古いまたは先の状態の版%iで保存すると競合を返し、どの行も変えない',
    async (expectedStateVersion) => {
      await saveDraft('terms', '元の下書き');
      const documentsBefore = await readAllDocumentRows();

      const result = await createStore().saveDraft({
        kind: 'terms',
        expectedStateVersion,
        body: '上書きしたい下書き',
        savedAt: after(900),
        savedByAdminId: ADMIN_B,
      });

      expect(result).toBe('conflict');
      expect(await readAllDocumentRows()).toEqual(documentsBefore);
    },
  );

  test('他の種類の文書を変えない', async () => {
    const before = await readDocumentRow('privacy');

    await saveDraft('terms', '利用規約の下書き');

    expect(await readDocumentRow('privacy')).toEqual(before);
  });
});

describe('D1LegalDocumentStore.discardDraft', () => {
  test('状態の版が一致し下書きがあれば下書きの3列を空にし、状態の版を1増やす', async () => {
    await saveDraft('terms', '下書き');

    const result = await createStore().discardDraft({
      kind: 'terms',
      expectedStateVersion: 1,
    });

    expect(result).toBe('discarded');
    expect(await readDocumentRow('terms')).toMatchObject({
      stateVersion: 2,
      draftBody: null,
      draftSavedAt: null,
      draftSavedByAdminId: null,
    });
  });

  test('古い状態の版で破棄すると競合を返し、どの行も変えない', async () => {
    await saveDraft('terms', '1回目');
    await saveDraft('terms', '2回目');
    const documentsBefore = await readAllDocumentRows();

    const result = await createStore().discardDraft({
      kind: 'terms',
      expectedStateVersion: 1,
    });

    expect(result).toBe('conflict');
    expect(await readAllDocumentRows()).toEqual(documentsBefore);
  });

  test('下書きが無ければ状態の版が一致しても競合を返し、どの行も変えない', async () => {
    const documentsBefore = await readAllDocumentRows();

    const result = await createStore().discardDraft({
      kind: 'terms',
      expectedStateVersion: 0,
    });

    expect(result).toBe('conflict');
    expect(await readAllDocumentRows()).toEqual(documentsBefore);
  });
});

describe('D1LegalDocumentStore.publish', () => {
  test('下書きの本文から版1を挿入し、文書の最新の版番号を1にして下書きを消し、状態の版を1増やす', async () => {
    await saveDraft('terms', '  第1版の本文\n\n- 項目  ');

    const result = await createStore().publish(
      publishInputOf('terms', 1, {
        versionId: versionIdOf(7),
        changeSummary: '初版を公開',
        publishedAt: after(1_000),
        publishedByAdminId: ADMIN_B,
      }),
    );

    expect(result).toBe('published');
    expect(await readAllVersionRows()).toEqual([
      {
        id: versionIdOf(7),
        documentId: SEEDED_DOCUMENTS[0].id,
        versionNumber: 1,
        body: '  第1版の本文\n\n- 項目  ',
        changeSummary: '初版を公開',
        publishedAt: after(1_000),
        publishedByAdminId: ADMIN_B,
        createdAt: after(1_000),
        updatedAt: after(1_000),
      },
    ]);
    expect(await readDocumentRow('terms')).toMatchObject({
      stateVersion: 2,
      latestVersionNumber: 1,
      draftBody: null,
      draftSavedAt: null,
      draftSavedByAdminId: null,
      updatedAt: after(1_000),
    });
  });

  test('公開を重ねると版番号が1からの連番になり、各版が公開時の下書きの本文を保つ', async () => {
    await publishDraft('terms', '第1版', { versionId: versionIdOf(1) });
    await publishDraft('terms', '第2版', {
      versionId: versionIdOf(2),
      publishedAt: after(2_000),
    });
    await publishDraft('terms', '第3版', {
      versionId: versionIdOf(3),
      publishedAt: after(3_000),
    });

    const versions = await readAllVersionRows();
    expect(
      versions.map(({ versionNumber, body }) => ({ versionNumber, body })),
    ).toEqual([
      { versionNumber: 1, body: '第1版' },
      { versionNumber: 2, body: '第2版' },
      { versionNumber: 3, body: '第3版' },
    ]);
    expect(await readDocumentRow('terms')).toMatchObject({
      stateVersion: 6,
      latestVersionNumber: 3,
    });
  });

  test('種類ごとに版番号を数え、他の種類の文書と版を変えない', async () => {
    await publishDraft('terms', '利用規約', { versionId: versionIdOf(1) });
    const privacyBefore = await readDocumentRow('privacy');

    await publishDraft('legal-notice', '法的通知', {
      versionId: versionIdOf(2),
    });

    expect(
      (await readAllVersionRows()).map(({ documentId, versionNumber }) => ({
        documentId,
        versionNumber,
      })),
    ).toEqual([
      { documentId: SEEDED_DOCUMENTS[0].id, versionNumber: 1 },
      { documentId: SEEDED_DOCUMENTS[2].id, versionNumber: 1 },
    ]);
    expect(await readDocumentRow('privacy')).toEqual(privacyBefore);
  });

  test('古い状態の版で公開すると競合を返し、版を挿入せず文書の行も変えない', async () => {
    await publishDraft('terms', '第1版', { versionId: versionIdOf(1) });
    await saveDraft('terms', '第2版の下書き');
    const documentsBefore = await readAllDocumentRows();
    const versionsBefore = await readAllVersionRows();

    const result = await createStore().publish(
      publishInputOf('terms', 1, { versionId: versionIdOf(2) }),
    );

    expect(result).toBe('conflict');
    expect(await readAllDocumentRows()).toEqual(documentsBefore);
    expect(await readAllVersionRows()).toEqual(versionsBefore);
  });

  test('下書きが無ければ状態の版が一致しても競合を返し、版を挿入せず文書の行も変えない', async () => {
    const documentsBefore = await readAllDocumentRows();

    const result = await createStore().publish(publishInputOf('terms', 0));

    expect(result).toBe('conflict');
    expect(await readAllDocumentRows()).toEqual(documentsBefore);
    expect(await readAllVersionRows()).toEqual([]);
  });

  test('同じ状態の版で2回続けて公開すると1回目だけが成功し、版は1つだけ増える', async () => {
    await saveDraft('terms', '第1版');
    const store = createStore();

    const first = await store.publish(
      publishInputOf('terms', 1, { versionId: versionIdOf(1) }),
    );
    const second = await store.publish(
      publishInputOf('terms', 1, { versionId: versionIdOf(2) }),
    );

    expect([first, second]).toEqual(['published', 'conflict']);
    expect(
      (await readAllVersionRows()).map(({ id, versionNumber }) => ({
        id,
        versionNumber,
      })),
    ).toEqual([{ id: versionIdOf(1), versionNumber: 1 }]);
    expect(await readDocumentRow('terms')).toMatchObject({
      stateVersion: 2,
      latestVersionNumber: 1,
    });
  });

  test('同じ状態の版の2つの公開を同時に送ると1つだけが成功する', async () => {
    await saveDraft('terms', '第1版');
    const store = createStore();

    const results = await Promise.all([
      store.publish(publishInputOf('terms', 1, { versionId: versionIdOf(1) })),
      store.publish(publishInputOf('terms', 1, { versionId: versionIdOf(2) })),
    ]);

    expect(results.toSorted()).toEqual(['conflict', 'published']);
    expect(await readAllVersionRows()).toHaveLength(1);
    expect(await readDocumentRow('terms')).toMatchObject({
      stateVersion: 2,
      latestVersionNumber: 1,
    });
  });

  test('採番する版番号が既にあって一意索引に違反すると競合を返し、文書の行を変えない', async () => {
    await saveDraft('terms', '下書き');
    await db.insert(legalDocumentVersions).values({
      id: versionIdOf(99),
      documentId: SEEDED_DOCUMENTS[0].id,
      versionNumber: 1,
      body: '最新の版番号と食い違う版',
      changeSummary: '想定外の重複',
      publishedAt: T0,
      publishedByAdminId: ADMIN_A,
      createdAt: T0,
      updatedAt: T0,
    });
    const documentsBefore = await readAllDocumentRows();
    const versionsBefore = await readAllVersionRows();

    const result = await createStore().publish(
      publishInputOf('terms', 1, { versionId: versionIdOf(1) }),
    );

    expect(result).toBe('conflict');
    expect(await readAllDocumentRows()).toEqual(documentsBefore);
    expect(await readAllVersionRows()).toEqual(versionsBefore);
  });

  test('版番号の一意索引以外の違反(版のIDの重複)は競合にせずそのまま投げる', async () => {
    await publishDraft('terms', '第1版', { versionId: versionIdOf(1) });
    await saveDraft('privacy', '下書き');

    await expect(
      createStore().publish(
        publishInputOf('privacy', 1, { versionId: versionIdOf(1) }),
      ),
    ).rejects.toThrow();
    expect(await readDocumentRow('privacy')).toMatchObject({
      stateVersion: 1,
      latestVersionNumber: 0,
      draftBody: '下書き',
    });
  });
});

describe('D1LegalDocumentStore.listRevisions', () => {
  test('版が無ければ空の一覧を返す', async () => {
    expect(await createStore().listRevisions('terms')).toEqual([]);
  });

  test('その種類の版を版番号の降順で、本文を含めずに返す', async () => {
    await publishDraft('terms', '第1版', {
      versionId: versionIdOf(1),
      changeSummary: '初版',
      publishedAt: after(1_000),
      publishedByAdminId: ADMIN_A,
    });
    await publishDraft('terms', '第2版', {
      versionId: versionIdOf(2),
      changeSummary: '第3条を改訂',
      publishedAt: after(2_000),
      publishedByAdminId: ADMIN_B,
    });
    await publishDraft('privacy', 'プライバシーポリシー', {
      versionId: versionIdOf(3),
    });

    expect(await createStore().listRevisions('terms')).toEqual([
      {
        versionNumber: 2,
        publishedAt: after(2_000),
        changeSummary: '第3条を改訂',
        publishedByAdminId: ADMIN_B,
      },
      {
        versionNumber: 1,
        publishedAt: after(1_000),
        changeSummary: '初版',
        publishedByAdminId: ADMIN_A,
      },
    ]);
  });
});

describe('D1LegalDocumentStore.findVersion', () => {
  test('指定の版の本文・変更概要・公開日時・公開者と、文書の最新の版番号を返す', async () => {
    await publishDraft('terms', '第1版', {
      versionId: versionIdOf(1),
      changeSummary: '初版',
      publishedAt: after(1_000),
      publishedByAdminId: ADMIN_A,
    });
    await publishDraft('terms', '第2版', {
      versionId: versionIdOf(2),
      publishedAt: after(2_000),
    });

    expect(await createStore().findVersion('terms', 1)).toEqual({
      versionNumber: 1,
      publishedAt: after(1_000),
      changeSummary: '初版',
      publishedByAdminId: ADMIN_A,
      body: '第1版',
      latestVersionNumber: 2,
    });
  });

  test('存在しない版番号と、他の種類にだけある版番号ではundefinedを返す', async () => {
    await publishDraft('terms', '第1版', { versionId: versionIdOf(1) });

    expect(await createStore().findVersion('terms', 2)).toBeUndefined();
    expect(await createStore().findVersion('privacy', 1)).toBeUndefined();
  });
});

describe('D1LegalDocumentStore.findPublishedAt', () => {
  beforeEach(async () => {
    await publishDraft('terms', '第1版', {
      versionId: versionIdOf(1),
      publishedAt: after(1_000),
    });
    await publishDraft('terms', '第2版', {
      versionId: versionIdOf(2),
      publishedAt: after(2_000),
    });
  });

  test('最初の版の公開日時より前はundefinedを返す', async () => {
    expect(
      await createStore().findPublishedAt('terms', after(999)),
    ).toBeUndefined();
  });

  test.each([
    { at: 1_000, versionNumber: 1, publishedAt: 1_000 },
    { at: 1_999, versionNumber: 1, publishedAt: 1_000 },
    { at: 2_000, versionNumber: 2, publishedAt: 2_000 },
    { at: 86_400_000, versionNumber: 2, publishedAt: 2_000 },
  ])(
    'T0+$atミリ秒では、公開日時が同じミリ秒を含むそれ以前で最も新しい版$versionNumberを返す',
    async ({ at, versionNumber, publishedAt }) => {
      expect(await createStore().findPublishedAt('terms', after(at))).toEqual({
        versionNumber,
        publishedAt: after(publishedAt),
      });
    },
  );

  test('公開日時が同じ版は版番号の大きい方を返す', async () => {
    await publishDraft('terms', '第3版', {
      versionId: versionIdOf(3),
      publishedAt: after(2_000),
    });

    expect(await createStore().findPublishedAt('terms', after(2_000))).toEqual({
      versionNumber: 3,
      publishedAt: after(2_000),
    });
  });

  test('版の無い種類はundefinedを返す', async () => {
    expect(
      await createStore().findPublishedAt('privacy', after(86_400_000)),
    ).toBeUndefined();
  });
});
