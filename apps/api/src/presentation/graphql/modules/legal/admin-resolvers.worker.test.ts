import { describe, expect, test } from 'vitest';

import {
  codesOf,
  detailsOf,
} from '../../../../../test/support/admin-graphql-operations.ts';
import {
  ADMIN_LEGAL_DOCUMENT,
  ADMIN_LEGAL_DOCUMENT_VERSION,
  ADMIN_LEGAL_DOCUMENTS,
  DISCARD_LEGAL_DOCUMENT_DRAFT,
  discardLegalDocumentDraft,
  fetchAdminLegalDocument,
  fetchAdminLegalDocumentVersion,
  installLegalAdminGraphQLTest,
  LEGAL_ADMINS,
  legalAdminGateway,
  legalAdminSessionOf,
  listAdminLegalDocuments,
  PUBLISH_LEGAL_DOCUMENT,
  publishLegalDocument,
  publishLegalDocumentAs,
  readLegalDocument,
  RFC3339_UTC_PATTERN,
  SAVE_LEGAL_DOCUMENT_DRAFT,
  saveLegalDocumentDraft,
  saveLegalDraftAs,
} from '../../../../../test/support/legal-graphql-operations.ts';
import { adminIdOf } from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

installLegalAdminGraphQLTest();

const { superAdmin, moderator, viewer, deleted } = LEGAL_ADMINS;

const OPERATIONS = [
  {
    name: 'adminLegalDocuments',
    document: ADMIN_LEGAL_DOCUMENTS,
    variables: {},
  },
  {
    name: 'adminLegalDocument',
    document: ADMIN_LEGAL_DOCUMENT,
    variables: { kind: 'TERMS' },
  },
  {
    name: 'adminLegalDocumentVersion',
    document: ADMIN_LEGAL_DOCUMENT_VERSION,
    variables: { kind: 'TERMS', versionNumber: 1 },
  },
  {
    name: 'saveLegalDocumentDraft',
    document: SAVE_LEGAL_DOCUMENT_DRAFT,
    variables: {
      input: { kind: 'TERMS', expectedStateVersion: 1, body: '# 書き換え' },
    },
  },
  {
    name: 'discardLegalDocumentDraft',
    document: DISCARD_LEGAL_DOCUMENT_DRAFT,
    variables: { input: { kind: 'TERMS', expectedStateVersion: 1 } },
  },
  {
    name: 'publishLegalDocument',
    document: PUBLISH_LEGAL_DOCUMENT,
    variables: {
      input: { kind: 'TERMS', expectedStateVersion: 1, changeSummary: '初版' },
    },
  },
] as const;

describe('管理の照会と変更の呼び出し元とログイン', () => {
  test.each(OPERATIONS)(
    '$nameは、最上位管理者のセッションでも利用者側の呼び出し元からならforbiddenで拒否し、下書きを返さず変えない',
    async ({ name, document, variables }) => {
      await saveLegalDraftAs(superAdmin, 'terms', '# 下書き');
      const before = await readLegalDocument('terms');

      const response = await legalAdminGateway.call(document, variables, {
        caller: 'client',
        sessionToken: legalAdminSessionOf(superAdmin),
      });

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data?.[name] ?? null).toBeNull();
      expect(JSON.stringify(response)).not.toContain('# 下書き');
      expect(await readLegalDocument('terms')).toEqual(before);
    },
  );

  test.each(OPERATIONS)(
    '$nameは、管理者側の呼び出し元でも未ログインならunauthenticatedで拒否し、下書きを変えない',
    async ({ name, document, variables }) => {
      await saveLegalDraftAs(superAdmin, 'terms', '# 下書き');
      const before = await readLegalDocument('terms');

      const response = await legalAdminGateway.call(document, variables);

      expect(codesOf(response)).toEqual(['unauthenticated']);
      expect(response.data?.[name] ?? null).toBeNull();
      expect(await readLegalDocument('terms')).toEqual(before);
    },
  );
});

describe('最上位管理者でない管理者の変更', () => {
  const MUTATIONS = [
    {
      name: 'saveLegalDocumentDraft',
      run: (adminIndex: number, stateVersion: number) =>
        saveLegalDocumentDraft(adminIndex, {
          kind: 'TERMS',
          expectedStateVersion: stateVersion,
          body: '# 書き換えた本文',
        }),
    },
    {
      name: 'discardLegalDocumentDraft',
      run: (adminIndex: number, stateVersion: number) =>
        discardLegalDocumentDraft(adminIndex, {
          kind: 'TERMS',
          expectedStateVersion: stateVersion,
        }),
    },
    {
      name: 'publishLegalDocument',
      run: (adminIndex: number, stateVersion: number) =>
        publishLegalDocument(adminIndex, {
          kind: 'TERMS',
          expectedStateVersion: stateVersion,
          changeSummary: '改訂',
        }),
    },
  ] as const;

  describe.each([
    { role: '閲覧のみ', adminIndex: viewer },
    { role: 'モデレーター', adminIndex: moderator },
  ])('$role', ({ adminIndex }) => {
    test.each(MUTATIONS)(
      '$nameをforbiddenで拒否し、データベースの文書と版を変えない',
      async ({ run }) => {
        await publishLegalDocumentAs(superAdmin, 'terms', '# 初版', '初版');
        await saveLegalDraftAs(superAdmin, 'terms', '# 下書き');
        const before = await readLegalDocument('terms');

        const response = await run(adminIndex, before.stateVersion);

        expect(codesOf(response)).toEqual(['forbidden']);
        expect(response.errors?.[0]?.message).toBe('この操作はできません。');
        expect(await readLegalDocument('terms')).toEqual(before);
      },
    );
  });
});

describe('adminLegalDocuments', () => {
  test.each([viewer, moderator, superAdmin])(
    'ロールを問わず(管理者%i)、3文書の最新版と下書きの有無を返す',
    async (adminIndex) => {
      await publishLegalDocumentAs(
        superAdmin,
        'privacy',
        '# プライバシーポリシー',
        '初版',
      );
      await saveLegalDraftAs(superAdmin, 'terms', '# 下書き');

      const response = await listAdminLegalDocuments(adminIndex);

      expect(response.errors).toBeUndefined();
      const documents = response.data?.adminLegalDocuments ?? [];
      expect(
        documents.map(({ kind, latestVersionNumber, hasDraft }) => ({
          kind,
          latestVersionNumber,
          hasDraft,
        })),
      ).toEqual([
        { kind: 'TERMS', latestVersionNumber: null, hasDraft: true },
        { kind: 'PRIVACY', latestVersionNumber: 1, hasDraft: false },
        { kind: 'LEGAL_NOTICE', latestVersionNumber: null, hasDraft: false },
      ]);
      expect(documents[0]?.latestPublishedAt).toBeNull();
      expect(documents[1]?.latestPublishedAt).toMatch(RFC3339_UTC_PATTERN);
    },
  );
});

describe('adminLegalDocument', () => {
  test('閲覧のみの管理者に、下書きと保存した管理者、公開者の名前を解決した改訂履歴を新しい順に返す', async () => {
    await publishLegalDocumentAs(deleted, 'terms', '# 利用規約 初版', '初版');
    await publishLegalDocumentAs(
      superAdmin,
      'terms',
      '# 利用規約 第2版',
      '禁止事項の追加',
    );
    await saveLegalDraftAs(superAdmin, 'terms', '# 利用規約 下書き');
    const stored = await readLegalDocument('terms');

    const response = await fetchAdminLegalDocument(viewer, 'TERMS');

    expect(response.errors).toBeUndefined();
    const document = response.data?.adminLegalDocument;
    expect(document).toMatchObject({
      kind: 'TERMS',
      stateVersion: stored.stateVersion,
      latestBody: '# 利用規約 第2版',
      draft: {
        body: '# 利用規約 下書き',
        savedBy: { id: adminIdOf(superAdmin), nickname: '管理者1' },
      },
    });
    expect(document?.draft?.savedAt).toMatch(RFC3339_UTC_PATTERN);
    expect(
      document?.revisions.map(
        ({ versionNumber, changeSummary, publishedBy }) => ({
          versionNumber,
          changeSummary,
          publishedBy,
        }),
      ),
    ).toEqual([
      {
        versionNumber: 2,
        changeSummary: '禁止事項の追加',
        publishedBy: { id: adminIdOf(superAdmin), nickname: '管理者1' },
      },
      {
        versionNumber: 1,
        changeSummary: '初版',
        publishedBy: { id: adminIdOf(deleted), nickname: null },
      },
    ]);
  });

  test('モデレーターに、未公開で下書きの無い文書を空の状態で返す', async () => {
    const response = await fetchAdminLegalDocument(moderator, 'LEGAL_NOTICE');

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminLegalDocument).toEqual({
      kind: 'LEGAL_NOTICE',
      stateVersion: (await readLegalDocument('legal-notice')).stateVersion,
      latestBody: null,
      draft: null,
      revisions: [],
    });
  });
});

describe('adminLegalDocumentVersion', () => {
  test('閲覧のみの管理者に、版を公開者の名前とともに返し、存在しない版はnullを返す', async () => {
    await publishLegalDocumentAs(superAdmin, 'privacy', '# 初版', '初版');
    await publishLegalDocumentAs(deleted, 'privacy', '# 第2版', '委託先の追加');

    const first = await fetchAdminLegalDocumentVersion(viewer, 'PRIVACY', 1);
    const second = await fetchAdminLegalDocumentVersion(viewer, 'PRIVACY', 2);
    const missing = await fetchAdminLegalDocumentVersion(viewer, 'PRIVACY', 3);

    expect(first.errors).toBeUndefined();
    expect(first.data?.adminLegalDocumentVersion).toMatchObject({
      kind: 'PRIVACY',
      versionNumber: 1,
      changeSummary: '初版',
      body: '# 初版',
      isLatest: false,
      publishedBy: { id: adminIdOf(superAdmin), nickname: '管理者1' },
    });
    expect(first.data?.adminLegalDocumentVersion?.publishedAt).toMatch(
      RFC3339_UTC_PATTERN,
    );
    expect(second.data?.adminLegalDocumentVersion).toMatchObject({
      versionNumber: 2,
      isLatest: true,
      publishedBy: { id: adminIdOf(deleted), nickname: null },
    });
    expect(missing.errors).toBeUndefined();
    expect(missing.data?.adminLegalDocumentVersion).toBeNull();
  });

  test('版番号が1未満なら版番号の欄の詳細を持つvalidation_errorにする', async () => {
    const response = await fetchAdminLegalDocumentVersion(viewer, 'PRIVACY', 0);

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'versionNumber',
        code: 'too_small',
        message: '版番号は1以上の整数で指定してください。',
      },
    ]);
  });
});
