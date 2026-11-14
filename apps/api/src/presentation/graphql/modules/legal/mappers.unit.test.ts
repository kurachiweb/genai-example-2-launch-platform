import { describe, expect, test } from 'bun:test';

import { LEGAL_DOCUMENT_KINDS } from '../../../../../common-lib/legal/legal-documents.ts';
import type {
  AdminLegalDocumentView,
  AdminLegalVersionView,
} from '../../../../application/legal/legal-document-admin-reader.ts';
import type {
  PublicLegalDocument,
  PublicLegalVersion,
} from '../../../../application/legal/legal-document-reader.ts';
import {
  LEGAL_DOCUMENT_KIND_VALUES,
  legalDocumentKindOf,
  toAdminLegalDocument,
  toAdminLegalDocumentSummary,
  toAdminLegalDocumentVersion,
  toLegalDocument,
  toLegalDocumentVersion,
} from './mappers.ts';

const PUBLISHED_AT = new Date('2026-11-05T00:00:00.000Z');

const SAVED_AT = new Date('2026-11-06T00:00:00.000Z');

const EDITOR = { id: '01JC0ADMN00000000000000001', nickname: '管理者1' };

const LATEST: PublicLegalVersion = {
  kind: 'legal-notice',
  versionNumber: 2,
  publishedAt: PUBLISHED_AT,
  changeSummary: '連絡先の変更',
  body: '# 法的通知',
  isLatest: true,
};

describe('LegalDocumentKindの相互変換', () => {
  test('3種類の値と列挙型の値を1対1に対応させる', () => {
    expect(LEGAL_DOCUMENT_KIND_VALUES).toEqual({
      terms: 'TERMS',
      privacy: 'PRIVACY',
      'legal-notice': 'LEGAL_NOTICE',
    });
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      expect(legalDocumentKindOf(LEGAL_DOCUMENT_KIND_VALUES[kind])).toBe(kind);
    }
  });
});

describe('公開の照会の変換', () => {
  test('最新版と文書の種類を列挙型の値にし、他の項目を写す', () => {
    const document: PublicLegalDocument = {
      kind: 'legal-notice',
      latest: LATEST,
      revisions: [
        {
          versionNumber: 2,
          publishedAt: PUBLISHED_AT,
          changeSummary: '連絡先の変更',
        },
      ],
    };

    expect(toLegalDocument(document)).toEqual({
      kind: 'LEGAL_NOTICE',
      latest: { ...LATEST, kind: 'LEGAL_NOTICE' },
      revisions: [...document.revisions],
    });
  });

  test('準備中の文書は最新版をnullのままにする', () => {
    expect(
      toLegalDocument({ kind: 'terms', latest: null, revisions: [] }),
    ).toEqual({ kind: 'TERMS', latest: null, revisions: [] });
  });

  test('版の種類を列挙型の値にする', () => {
    expect(toLegalDocumentVersion(LATEST)).toEqual({
      ...LATEST,
      kind: 'LEGAL_NOTICE',
    });
  });
});

describe('管理の照会の変換', () => {
  test('一覧の行の種類を列挙型の値にする', () => {
    expect(
      toAdminLegalDocumentSummary({
        kind: 'privacy',
        latestVersionNumber: null,
        latestPublishedAt: null,
        hasDraft: true,
      }),
    ).toEqual({
      kind: 'PRIVACY',
      latestVersionNumber: null,
      latestPublishedAt: null,
      hasDraft: true,
    });
  });

  test('文書の種類を列挙型の値にし、下書きと公開者を写す', () => {
    const view: AdminLegalDocumentView = {
      kind: 'terms',
      stateVersion: 3,
      latestBody: '# 利用規約',
      draft: {
        body: '# 利用規約 改訂案',
        savedAt: SAVED_AT,
        savedBy: { id: EDITOR.id, nickname: null },
      },
      revisions: [
        {
          versionNumber: 1,
          publishedAt: PUBLISHED_AT,
          changeSummary: '初版',
          publishedBy: EDITOR,
        },
      ],
    };

    expect(toAdminLegalDocument(view)).toEqual({
      ...view,
      kind: 'TERMS',
      revisions: [...view.revisions],
    });
  });

  test('版の種類を列挙型の値にし、公開者を写す', () => {
    const view: AdminLegalVersionView = { ...LATEST, publishedBy: EDITOR };

    expect(toAdminLegalDocumentVersion(view)).toEqual({
      ...view,
      kind: 'LEGAL_NOTICE',
    });
  });
});
