import { describe, expect, expectTypeOf, test } from 'bun:test';

import { Container } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import type { LegalDocumentState } from '../../domain/legal/legal-document.ts';
import {
  type LegalDocumentReader,
  type PublicLegalDocument,
  type PublicLegalRevision,
  type PublicLegalVersion,
  StoreLegalDocumentReader,
} from './legal-document-reader.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type { LegalDocumentStore, LegalRevisionRecord } from './ports.ts';

const PUBLISHER_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';
const DRAFT_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRT';
const DRAFT_BODY = '# 利用規約\n\n公開前の下書きの本文';

interface FakeVersion {
  readonly versionNumber: number;
  readonly publishedAt: Date;
  readonly changeSummary: string;
  readonly body: string;
  readonly publishedByAdminId: string;
}

const VERSION_1: FakeVersion = {
  versionNumber: 1,
  publishedAt: new Date('2026-11-05T01:00:00.000Z'),
  changeSummary: '初版',
  body: '# 利用規約\n\n第1版の本文',
  publishedByAdminId: PUBLISHER_ADMIN_ID,
};

const VERSION_2: FakeVersion = {
  versionNumber: 2,
  publishedAt: new Date('2026-12-01T03:00:00.000Z'),
  changeSummary: '第3条を改定',
  body: '# 利用規約\n\n第2版の本文',
  publishedByAdminId: PUBLISHER_ADMIN_ID,
};

const VERSION_3: FakeVersion = {
  versionNumber: 3,
  publishedAt: new Date('2027-01-10T09:30:00.000Z'),
  changeSummary: '問い合わせ先を追記',
  body: '# 利用規約\n\n第3版の本文',
  publishedByAdminId: PUBLISHER_ADMIN_ID,
};

interface FakeOptions {
  readonly versions?: readonly FakeVersion[];
  readonly hasDraft?: boolean;
  // 状態の読み取りの後に公開された版で、改訂履歴の一覧にだけ現れる
  readonly publishedAfterState?: readonly FakeVersion[];
  readonly revisionsOverride?: readonly FakeVersion[];
}

function toRevisionRecord(version: FakeVersion): LegalRevisionRecord {
  return {
    versionNumber: version.versionNumber,
    publishedAt: version.publishedAt,
    changeSummary: version.changeSummary,
    publishedByAdminId: version.publishedByAdminId,
  };
}

function setup(options: FakeOptions = {}) {
  const versions = options.versions ?? [];
  const latest = versions.at(-1);
  const allVersions = [...versions, ...(options.publishedAfterState ?? [])];
  const calls: string[] = [];
  const state = (kind: LegalDocumentKind): LegalDocumentState => ({
    kind,
    stateVersion: 7,
    latest:
      latest === undefined
        ? null
        : {
            versionNumber: latest.versionNumber,
            body: latest.body,
            publishedAt: latest.publishedAt,
          },
    draft:
      options.hasDraft === true
        ? {
            body: DRAFT_BODY,
            savedAt: new Date('2027-02-01T00:00:00.000Z'),
            savedByAdminId: DRAFT_ADMIN_ID,
          }
        : null,
  });
  const store: LegalDocumentStore = {
    findState: (kind) => {
      calls.push(`findState:${kind}`);
      return Promise.resolve(state(kind));
    },
    listSummaries: () =>
      Promise.reject(new Error('一覧の照会は呼ばれない想定です')),
    listRevisions: (kind) => {
      calls.push(`listRevisions:${kind}`);
      return Promise.resolve(
        (options.revisionsOverride ?? allVersions)
          .map(toRevisionRecord)
          .toReversed(),
      );
    },
    findVersion: (kind, versionNumber) => {
      calls.push(`findVersion:${kind}:${String(versionNumber)}`);
      const found = allVersions.find(
        (version) => version.versionNumber === versionNumber,
      );
      return Promise.resolve(
        found === undefined
          ? undefined
          : {
              ...toRevisionRecord(found),
              body: found.body,
              latestVersionNumber: allVersions.at(-1)?.versionNumber ?? 0,
            },
      );
    },
    findPublishedAt: () =>
      Promise.reject(new Error('日時による版の特定は呼ばれない想定です')),
    saveDraft: () => Promise.reject(new Error('保存は呼ばれない想定です')),
    discardDraft: () => Promise.reject(new Error('破棄は呼ばれない想定です')),
    publish: () => Promise.reject(new Error('公開は呼ばれない想定です')),
  };
  const reader = new StoreLegalDocumentReader(store);
  return { reader, store, calls };
}

function expectNoAdminOrDraft(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(PUBLISHER_ADMIN_ID);
  expect(serialized).not.toContain(DRAFT_ADMIN_ID);
  expect(serialized).not.toContain(DRAFT_BODY);
}

describe('StoreLegalDocumentReader.getDocument', () => {
  test('最新版と、新しい順の改訂履歴を返す', async () => {
    const { reader } = setup({ versions: [VERSION_1, VERSION_2, VERSION_3] });

    const document = await reader.getDocument('terms');

    expect(document).toStrictEqual({
      kind: 'terms',
      latest: {
        kind: 'terms',
        versionNumber: 3,
        publishedAt: VERSION_3.publishedAt,
        changeSummary: '問い合わせ先を追記',
        body: VERSION_3.body,
        isLatest: true,
      },
      revisions: [
        {
          versionNumber: 3,
          publishedAt: VERSION_3.publishedAt,
          changeSummary: '問い合わせ先を追記',
        },
        {
          versionNumber: 2,
          publishedAt: VERSION_2.publishedAt,
          changeSummary: '第3条を改定',
        },
        {
          versionNumber: 1,
          publishedAt: VERSION_1.publishedAt,
          changeSummary: '初版',
        },
      ],
    });
  });

  test('版が無い文書は準備中として最新版をnullにし、改訂履歴を空にする', async () => {
    const { reader } = setup({ versions: [], hasDraft: true });

    const document = await reader.getDocument('privacy');

    expect(document).toStrictEqual({
      kind: 'privacy',
      latest: null,
      revisions: [],
    });
  });

  test('下書きと、公開・保存した管理者のIDを結果に含めない', async () => {
    const { reader } = setup({
      versions: [VERSION_1, VERSION_2],
      hasDraft: true,
    });

    const document = await reader.getDocument('terms');

    expectNoAdminOrDraft(document);
  });

  test('状態を読んだ後に公開された版を改訂履歴に含めず、最新版と改訂履歴を同じ時点に揃える', async () => {
    const { reader, calls } = setup({
      versions: [VERSION_1, VERSION_2],
      publishedAfterState: [VERSION_3],
    });

    const document = await reader.getDocument('legal-notice');

    expect(document.latest?.versionNumber).toBe(2);
    expect(document.latest?.changeSummary).toBe('第3条を改定');
    expect(
      document.revisions.map((revision) => revision.versionNumber),
    ).toEqual([2, 1]);
    expect(calls).toEqual([
      'findState:legal-notice',
      'listRevisions:legal-notice',
    ]);
  });

  test('最新版の改訂履歴が見つからなければ例外にする', async () => {
    const { reader } = setup({
      versions: [VERSION_1, VERSION_2],
      revisionsOverride: [VERSION_1],
    });

    const error: unknown = await reader
      .getDocument('terms')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      '法務文書の最新版の改訂履歴がありません: terms 2',
    );
  });
});

describe('StoreLegalDocumentReader.getVersion', () => {
  test('指定の版を返し、最新版でなければisLatestをfalseにする', async () => {
    const { reader, calls } = setup({
      versions: [VERSION_1, VERSION_2, VERSION_3],
    });

    const version = await reader.getVersion('terms', 2);

    expect(version).toStrictEqual({
      kind: 'terms',
      versionNumber: 2,
      publishedAt: VERSION_2.publishedAt,
      changeSummary: '第3条を改定',
      body: VERSION_2.body,
      isLatest: false,
    });
    expect(calls).toEqual(['findVersion:terms:2']);
  });

  test('最新版を指定するとisLatestをtrueにする', async () => {
    const { reader } = setup({ versions: [VERSION_1, VERSION_2, VERSION_3] });

    const version = await reader.getVersion('privacy', 3);

    expect(version?.isLatest).toBe(true);
    expect(version?.kind).toBe('privacy');
  });

  test('存在しない版はundefinedを返す', async () => {
    const { reader } = setup({ versions: [VERSION_1] });

    expect(await reader.getVersion('terms', 2)).toBeUndefined();
  });

  test('公開した管理者のIDを結果に含めない', async () => {
    const { reader } = setup({ versions: [VERSION_1], hasDraft: true });

    const version = await reader.getVersion('terms', 1);

    expect(version).toBeDefined();
    expectNoAdminOrDraft(version);
  });
});

describe('公開の照会の型', () => {
  test('管理者の情報と下書きの項目を持たない', () => {
    expectTypeOf<keyof PublicLegalVersion>().toEqualTypeOf<
      | 'kind'
      | 'versionNumber'
      | 'publishedAt'
      | 'changeSummary'
      | 'body'
      | 'isLatest'
    >();
    expectTypeOf<keyof PublicLegalRevision>().toEqualTypeOf<
      'versionNumber' | 'publishedAt' | 'changeSummary'
    >();
    expectTypeOf<keyof PublicLegalDocument>().toEqualTypeOf<
      'kind' | 'latest' | 'revisions'
    >();
    expectTypeOf<
      PublicLegalDocument['latest']
    >().toEqualTypeOf<PublicLegalVersion | null>();
    expectTypeOf<PublicLegalDocument['revisions']>().toEqualTypeOf<
      readonly PublicLegalRevision[]
    >();
  });
});

describe('LegalDocumentReaderの束縛', () => {
  test('ストアを識別子で注入して解決できる', async () => {
    const { store } = setup({ versions: [VERSION_1] });
    const container = new Container();
    container
      .bind<LegalDocumentStore>(LEGAL_TYPES.LegalDocumentStore)
      .toConstantValue(store);
    container
      .bind<LegalDocumentReader>(LEGAL_TYPES.LegalDocumentReader)
      .to(StoreLegalDocumentReader);

    const reader = container.get<LegalDocumentReader>(
      LEGAL_TYPES.LegalDocumentReader,
    );

    expect((await reader.getVersion('terms', 1))?.isLatest).toBe(true);
  });
});
