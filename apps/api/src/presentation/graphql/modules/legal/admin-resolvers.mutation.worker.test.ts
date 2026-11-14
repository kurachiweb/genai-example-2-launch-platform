import { describe, expect, test } from 'vitest';

import {
  codesOf,
  detailsOf,
} from '../../../../../test/support/admin-graphql-operations.ts';
import {
  discardLegalDocumentDraft,
  installLegalAdminGraphQLTest,
  LEGAL_ADMINS,
  publishLegalDocument,
  publishLegalDocumentAs,
  readLegalDocument,
  RFC3339_UTC_PATTERN,
  saveLegalDocumentDraft,
  saveLegalDraftAs,
} from '../../../../../test/support/legal-graphql-operations.ts';
import { adminIdOf } from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

installLegalAdminGraphQLTest();

const { superAdmin } = LEGAL_ADMINS;

const CONFLICT_MESSAGE =
  '他の管理者がこの文書を更新しました。最新の内容を読み込んでから、もう一度操作してください。';

describe('saveLegalDocumentDraft', () => {
  test('最上位管理者が保存すると、下書きと保存した管理者を記録し、状態の版を1つ進めた文書を返す', async () => {
    const before = await readLegalDocument('terms');

    const response = await saveLegalDocumentDraft(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: before.stateVersion,
      body: '# 利用規約\n\n本文',
    });

    expect(response.errors).toBeUndefined();
    const document = response.data?.saveLegalDocumentDraft;
    expect(document).toMatchObject({
      kind: 'TERMS',
      stateVersion: before.stateVersion + 1,
      latestBody: null,
      draft: {
        body: '# 利用規約\n\n本文',
        savedBy: { id: adminIdOf(superAdmin), nickname: '管理者1' },
      },
      revisions: [],
    });
    expect(document?.draft?.savedAt).toMatch(RFC3339_UTC_PATTERN);
    const stored = await readLegalDocument('terms');
    expect(stored.stateVersion).toBe(before.stateVersion + 1);
    expect(stored.draft?.body).toBe('# 利用規約\n\n本文');
  });

  test('本文は前後の空白を含めて入力のまま保存する', async () => {
    const before = await readLegalDocument('privacy');

    const response = await saveLegalDocumentDraft(superAdmin, {
      kind: 'PRIVACY',
      expectedStateVersion: before.stateVersion,
      body: '\n  # 見出し  \n',
    });

    expect(response.errors).toBeUndefined();
    expect((await readLegalDocument('privacy')).draft?.body).toBe(
      '\n  # 見出し  \n',
    );
  });

  test('本文がちょうど100,000書記素なら保存する', async () => {
    const before = await readLegalDocument('terms');

    const response = await saveLegalDocumentDraft(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: before.stateVersion,
      body: 'あ'.repeat(100_000),
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.saveLegalDocumentDraft?.stateVersion).toBe(
      before.stateVersion + 1,
    );
  });

  test.each([
    { label: '空', body: '', message: '本文を入力してください。' },
    { label: '空白だけ', body: ' \n\t ', message: '本文を入力してください。' },
    {
      label: '100,001書記素',
      body: 'あ'.repeat(100_001),
      message: '本文は100,000文字以内で入力してください。',
    },
    {
      label: '禁止文字を含む',
      body: '本文\u0000',
      message: '本文に使用できない文字が含まれています。',
    },
  ])(
    '本文が$labelなら、保存せずに本文の欄の詳細を持つvalidation_errorにする',
    async ({ body, message }) => {
      const before = await readLegalDocument('terms');

      const response = await saveLegalDocumentDraft(superAdmin, {
        kind: 'TERMS',
        expectedStateVersion: before.stateVersion,
        body,
      });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        { field: 'input.body', code: 'custom', message },
      ]);
      expect(await readLegalDocument('terms')).toEqual(before);
    },
  );

  test('状態の版が負の数なら、状態の版の欄の詳細を持つvalidation_errorにする', async () => {
    const response = await saveLegalDocumentDraft(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: -1,
      body: '# 本文',
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.expectedStateVersion',
        code: 'too_small',
        message: '状態の版は0以上の整数で指定してください。',
      },
    ]);
  });

  test('読み込んだ後に他の操作で状態が変わっていれば、上書きせずにlegal_document_conflictで拒否する', async () => {
    const loaded = await readLegalDocument('terms');
    await saveLegalDraftAs(superAdmin, 'terms', '# 先に保存した下書き');

    const response = await saveLegalDocumentDraft(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: loaded.stateVersion,
      body: '# 後から保存する下書き',
    });

    expect(codesOf(response)).toEqual(['legal_document_conflict']);
    expect(response.errors?.[0]?.message).toBe(CONFLICT_MESSAGE);
    expect((await readLegalDocument('terms')).draft?.body).toBe(
      '# 先に保存した下書き',
    );
  });
});

describe('discardLegalDocumentDraft', () => {
  test('最上位管理者が破棄すると、下書きを消して版には影響を与えない', async () => {
    await publishLegalDocumentAs(superAdmin, 'terms', '# 初版', '初版');
    await saveLegalDraftAs(superAdmin, 'terms', '# 下書き');
    const before = await readLegalDocument('terms');

    const response = await discardLegalDocumentDraft(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: before.stateVersion,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.discardLegalDocumentDraft).toMatchObject({
      kind: 'TERMS',
      stateVersion: before.stateVersion + 1,
      latestBody: '# 初版',
      draft: null,
    });
    expect(
      response.data?.discardLegalDocumentDraft?.revisions.map(
        ({ versionNumber }) => versionNumber,
      ),
    ).toEqual([1]);
    expect((await readLegalDocument('terms')).revisions).toEqual(
      before.revisions,
    );
  });

  test('下書きが無ければlegal_document_draft_missingで拒否する', async () => {
    const before = await readLegalDocument('terms');

    const response = await discardLegalDocumentDraft(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: before.stateVersion,
    });

    expect(codesOf(response)).toEqual(['legal_document_draft_missing']);
    expect(await readLegalDocument('terms')).toEqual(before);
  });

  test('状態の版が古ければlegal_document_conflictで拒否し、下書きを残す', async () => {
    const loaded = await readLegalDocument('terms');
    await saveLegalDraftAs(superAdmin, 'terms', '# 下書き');

    const response = await discardLegalDocumentDraft(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: loaded.stateVersion,
    });

    expect(codesOf(response)).toEqual(['legal_document_conflict']);
    expect((await readLegalDocument('terms')).draft?.body).toBe('# 下書き');
  });
});

describe('publishLegalDocument', () => {
  test('最上位管理者が公開すると、下書きを次の版として前後の空白を除いた変更概要と公開者とともに記録し、下書きを消す', async () => {
    await saveLegalDraftAs(superAdmin, 'legal-notice', '# 法的通知');
    const before = await readLegalDocument('legal-notice');

    const response = await publishLegalDocument(superAdmin, {
      kind: 'LEGAL_NOTICE',
      expectedStateVersion: before.stateVersion,
      changeSummary: '  初版の公開　',
    });

    expect(response.errors).toBeUndefined();
    const document = response.data?.publishLegalDocument;
    expect(document).toMatchObject({
      kind: 'LEGAL_NOTICE',
      stateVersion: before.stateVersion + 1,
      latestBody: '# 法的通知',
      draft: null,
      revisions: [
        {
          versionNumber: 1,
          changeSummary: '初版の公開',
          publishedBy: { id: adminIdOf(superAdmin), nickname: '管理者1' },
        },
      ],
    });
    expect(document?.revisions[0]?.publishedAt).toMatch(RFC3339_UTC_PATTERN);
    expect((await readLegalDocument('legal-notice')).revisions).toHaveLength(1);
  });

  test.each([
    {
      label: '空白だけ',
      changeSummary: '  ',
      message: '変更概要を入力してください。',
    },
    {
      label: '201書記素',
      changeSummary: 'あ'.repeat(201),
      message: '変更概要は200文字以内で入力してください。',
    },
    {
      label: '改行を含む',
      changeSummary: '1行目\n2行目',
      message: '変更概要に改行は使用できません。',
    },
    {
      label: '禁止文字を含む',
      changeSummary: '改訂\u0000',
      message: '変更概要に使用できない文字が含まれています。',
    },
  ])(
    '変更概要が$labelなら、公開せずに変更概要の欄の詳細を持つvalidation_errorにする',
    async ({ changeSummary, message }) => {
      await saveLegalDraftAs(superAdmin, 'terms', '# 下書き');
      const before = await readLegalDocument('terms');

      const response = await publishLegalDocument(superAdmin, {
        kind: 'TERMS',
        expectedStateVersion: before.stateVersion,
        changeSummary,
      });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        { field: 'input.changeSummary', code: 'custom', message },
      ]);
      expect(await readLegalDocument('terms')).toEqual(before);
    },
  );

  test('下書きが無ければlegal_document_draft_missingで拒否する', async () => {
    const before = await readLegalDocument('terms');

    const response = await publishLegalDocument(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: before.stateVersion,
      changeSummary: '初版',
    });

    expect(codesOf(response)).toEqual(['legal_document_draft_missing']);
    expect(response.errors?.[0]?.message).toBe('公開する下書きがありません。');
    expect(await readLegalDocument('terms')).toEqual(before);
  });

  test('下書きの本文が最新版と同じならlegal_document_unchangedで拒否する', async () => {
    await publishLegalDocumentAs(superAdmin, 'terms', '# 同じ本文', '初版');
    await saveLegalDraftAs(superAdmin, 'terms', '# 同じ本文');
    const before = await readLegalDocument('terms');

    const response = await publishLegalDocument(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: before.stateVersion,
      changeSummary: '変更なし',
    });

    expect(codesOf(response)).toEqual(['legal_document_unchanged']);
    expect(response.errors?.[0]?.message).toBe(
      '公開中の版から本文が変更されていません。',
    );
    expect(await readLegalDocument('terms')).toEqual(before);
  });

  test('読み込んだ後に下書きが保存し直されていれば、公開せずにlegal_document_conflictで拒否する', async () => {
    await saveLegalDraftAs(superAdmin, 'terms', '# 読み込んだ下書き');
    const loaded = await readLegalDocument('terms');
    await saveLegalDraftAs(superAdmin, 'terms', '# 他の管理者の下書き');

    const response = await publishLegalDocument(superAdmin, {
      kind: 'TERMS',
      expectedStateVersion: loaded.stateVersion,
      changeSummary: '初版',
    });

    expect(codesOf(response)).toEqual(['legal_document_conflict']);
    expect(response.errors?.[0]?.message).toBe(CONFLICT_MESSAGE);
    const stored = await readLegalDocument('terms');
    expect(stored.revisions).toEqual([]);
    expect(stored.draft?.body).toBe('# 他の管理者の下書き');
  });
});
