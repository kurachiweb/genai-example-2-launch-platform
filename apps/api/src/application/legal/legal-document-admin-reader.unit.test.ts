import { describe, expect, test } from 'bun:test';

import { Container } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import type {
  AdminDirectory,
  AdminProfileView,
} from '../../../lib/core/admin/ports.ts';
import type { LegalDocumentState } from '../../domain/legal/legal-document.ts';
import {
  type LegalDocumentAdminReader,
  StoreLegalDocumentAdminReader,
} from './legal-document-admin-reader.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type {
  LegalDocumentStore,
  LegalDocumentSummaryRecord,
  LegalRevisionRecord,
} from './ports.ts';

const OWNER_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';
const EDITOR_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRT';
const DELETED_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRV';
const DRAFT_BODY = '# 利用規約\n\n公開前の下書きの本文';
const DRAFT_SAVED_AT = new Date('2027-02-01T00:00:00.000Z');
const STATE_VERSION = 7;

const PROFILES: ReadonlyMap<string, AdminProfileView> = new Map([
  [
    OWNER_ADMIN_ID,
    {
      id: OWNER_ADMIN_ID,
      nickname: '運営の山田',
      title: '代表',
      avatarFileId: null,
    },
  ],
  [
    EDITOR_ADMIN_ID,
    {
      id: EDITOR_ADMIN_ID,
      nickname: '法務の佐藤',
      title: null,
      avatarFileId: null,
    },
  ],
]);

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
  publishedByAdminId: DELETED_ADMIN_ID,
};

const VERSION_2: FakeVersion = {
  versionNumber: 2,
  publishedAt: new Date('2026-12-01T03:00:00.000Z'),
  changeSummary: '第3条を改定',
  body: '# 利用規約\n\n第2版の本文',
  publishedByAdminId: OWNER_ADMIN_ID,
};

const VERSION_3: FakeVersion = {
  versionNumber: 3,
  publishedAt: new Date('2027-01-10T09:30:00.000Z'),
  changeSummary: '問い合わせ先を追記',
  body: '# 利用規約\n\n第3版の本文',
  publishedByAdminId: OWNER_ADMIN_ID,
};

const SUMMARIES: readonly LegalDocumentSummaryRecord[] = [
  {
    kind: 'terms',
    latestVersionNumber: 3,
    latestPublishedAt: VERSION_3.publishedAt,
    hasDraft: true,
  },
  {
    kind: 'privacy',
    latestVersionNumber: null,
    latestPublishedAt: null,
    hasDraft: false,
  },
  {
    kind: 'legal-notice',
    latestVersionNumber: 1,
    latestPublishedAt: VERSION_1.publishedAt,
    hasDraft: false,
  },
];

interface FakeOptions {
  readonly versions?: readonly FakeVersion[];
  readonly draftSavedByAdminId?: string;
  // 状態の読み取りの後に公開された版で、改訂履歴の一覧と版の照会にだけ現れる
  readonly publishedAfterState?: readonly FakeVersion[];
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
  const directoryCalls: (readonly string[])[] = [];
  const state = (kind: LegalDocumentKind): LegalDocumentState => ({
    kind,
    stateVersion: STATE_VERSION,
    latest:
      latest === undefined
        ? null
        : {
            versionNumber: latest.versionNumber,
            body: latest.body,
            publishedAt: latest.publishedAt,
          },
    draft:
      options.draftSavedByAdminId === undefined
        ? null
        : {
            body: DRAFT_BODY,
            savedAt: DRAFT_SAVED_AT,
            savedByAdminId: options.draftSavedByAdminId,
          },
  });
  const store: LegalDocumentStore = {
    findState: (kind) => {
      calls.push(`findState:${kind}`);
      return Promise.resolve(state(kind));
    },
    listSummaries: () => {
      calls.push('listSummaries');
      return Promise.resolve(SUMMARIES);
    },
    listRevisions: (kind) => {
      calls.push(`listRevisions:${kind}`);
      return Promise.resolve(allVersions.map(toRevisionRecord).toReversed());
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
  const directory: AdminDirectory = {
    findProfiles: (ids) => {
      directoryCalls.push(ids);
      return Promise.resolve(
        new Map(
          ids.flatMap((id) => {
            const profile = PROFILES.get(id);
            return profile === undefined ? [] : [[id, profile] as const];
          }),
        ),
      );
    },
  };
  const reader = new StoreLegalDocumentAdminReader(store, directory);
  return { reader, store, directory, calls, directoryCalls };
}

describe('StoreLegalDocumentAdminReader.listDocuments', () => {
  test('3文書の最新版の版番号と公開日時・下書きの有無を種類の順に返す', async () => {
    const { reader, calls, directoryCalls } = setup();

    const documents = await reader.listDocuments();

    expect(documents).toStrictEqual(SUMMARIES);
    expect(calls).toEqual(['listSummaries']);
    expect(directoryCalls).toEqual([]);
  });
});

describe('StoreLegalDocumentAdminReader.getDocument', () => {
  test('状態の版・最新版の本文・下書き・新しい順の改訂履歴を、公開者と保存者のニックネームとともに返す', async () => {
    const { reader } = setup({
      versions: [VERSION_1, VERSION_2, VERSION_3],
      draftSavedByAdminId: EDITOR_ADMIN_ID,
    });

    const document = await reader.getDocument('terms');

    expect(document).toStrictEqual({
      kind: 'terms',
      stateVersion: STATE_VERSION,
      latestBody: VERSION_3.body,
      draft: {
        body: DRAFT_BODY,
        savedAt: DRAFT_SAVED_AT,
        savedBy: { id: EDITOR_ADMIN_ID, nickname: '法務の佐藤' },
      },
      revisions: [
        {
          versionNumber: 3,
          publishedAt: VERSION_3.publishedAt,
          changeSummary: '問い合わせ先を追記',
          publishedBy: { id: OWNER_ADMIN_ID, nickname: '運営の山田' },
        },
        {
          versionNumber: 2,
          publishedAt: VERSION_2.publishedAt,
          changeSummary: '第3条を改定',
          publishedBy: { id: OWNER_ADMIN_ID, nickname: '運営の山田' },
        },
        {
          versionNumber: 1,
          publishedAt: VERSION_1.publishedAt,
          changeSummary: '初版',
          publishedBy: { id: DELETED_ADMIN_ID, nickname: null },
        },
      ],
    });
  });

  test('版と下書きの管理者のIDを、重複を除いてまとめて1回で引く', async () => {
    const { reader, directoryCalls } = setup({
      versions: [VERSION_1, VERSION_2, VERSION_3],
      draftSavedByAdminId: OWNER_ADMIN_ID,
    });

    await reader.getDocument('terms');

    expect(directoryCalls).toEqual([[OWNER_ADMIN_ID, DELETED_ADMIN_ID]]);
  });

  test('削除済みの管理者が保存した下書きは、保存者のニックネームをnullにして失敗しない', async () => {
    const { reader } = setup({
      versions: [VERSION_1],
      draftSavedByAdminId: DELETED_ADMIN_ID,
    });

    const document = await reader.getDocument('privacy');

    expect(document.draft?.savedBy).toStrictEqual({
      id: DELETED_ADMIN_ID,
      nickname: null,
    });
    expect(document.revisions[0]?.publishedBy).toStrictEqual({
      id: DELETED_ADMIN_ID,
      nickname: null,
    });
  });

  test('版が無く下書きだけがある文書は、最新版の本文をnull・改訂履歴を空にし、保存者だけを引く', async () => {
    const { reader, calls, directoryCalls } = setup({
      versions: [],
      draftSavedByAdminId: EDITOR_ADMIN_ID,
    });

    const document = await reader.getDocument('legal-notice');

    expect(document).toStrictEqual({
      kind: 'legal-notice',
      stateVersion: STATE_VERSION,
      latestBody: null,
      draft: {
        body: DRAFT_BODY,
        savedAt: DRAFT_SAVED_AT,
        savedBy: { id: EDITOR_ADMIN_ID, nickname: '法務の佐藤' },
      },
      revisions: [],
    });
    expect(calls).toEqual(['findState:legal-notice']);
    expect(directoryCalls).toEqual([[EDITOR_ADMIN_ID]]);
  });

  test('版も下書きも無い文書は、管理者の照会口を呼ばずに空の状態を返す', async () => {
    const { reader, directoryCalls } = setup();

    const document = await reader.getDocument('privacy');

    expect(document).toStrictEqual({
      kind: 'privacy',
      stateVersion: STATE_VERSION,
      latestBody: null,
      draft: null,
      revisions: [],
    });
    expect(directoryCalls).toEqual([]);
  });

  test('状態を読んだ後に公開された版を改訂履歴に含めず、状態の版と改訂履歴を同じ時点に揃える', async () => {
    const { reader, calls, directoryCalls } = setup({
      versions: [VERSION_1, VERSION_2],
      publishedAfterState: [VERSION_3],
    });

    const document = await reader.getDocument('terms');

    expect(document.latestBody).toBe(VERSION_2.body);
    expect(
      document.revisions.map((revision) => revision.versionNumber),
    ).toEqual([2, 1]);
    expect(calls).toEqual(['findState:terms', 'listRevisions:terms']);
    expect(directoryCalls).toEqual([[OWNER_ADMIN_ID, DELETED_ADMIN_ID]]);
  });
});

describe('StoreLegalDocumentAdminReader.getVersion', () => {
  test('指定の版の本文・版番号・公開日時・変更概要と公開者のニックネームを返す', async () => {
    const { reader, calls, directoryCalls } = setup({
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
      publishedBy: { id: OWNER_ADMIN_ID, nickname: '運営の山田' },
    });
    expect(calls).toEqual(['findVersion:terms:2']);
    expect(directoryCalls).toEqual([[OWNER_ADMIN_ID]]);
  });

  test('削除済みの管理者が公開した最新版は、公開者のニックネームをnullにして失敗しない', async () => {
    const { reader } = setup({ versions: [VERSION_1] });

    const version = await reader.getVersion('legal-notice', 1);

    expect(version?.isLatest).toBe(true);
    expect(version?.publishedBy).toStrictEqual({
      id: DELETED_ADMIN_ID,
      nickname: null,
    });
  });

  test('存在しない版はundefinedを返し、管理者の照会口を呼ばない', async () => {
    const { reader, directoryCalls } = setup({ versions: [VERSION_1] });

    expect(await reader.getVersion('terms', 2)).toBeUndefined();
    expect(directoryCalls).toEqual([]);
  });
});

describe('LegalDocumentAdminReaderの束縛', () => {
  test('ストアと管理者の照会口を識別子で注入して解決できる', async () => {
    const { store, directory } = setup({ versions: [VERSION_1] });
    const container = new Container();
    container
      .bind<LegalDocumentStore>(LEGAL_TYPES.LegalDocumentStore)
      .toConstantValue(store);
    container
      .bind<AdminDirectory>(ADMIN_PLATFORM_TYPES.AdminDirectory)
      .toConstantValue(directory);
    container
      .bind<LegalDocumentAdminReader>(LEGAL_TYPES.LegalDocumentAdminReader)
      .to(StoreLegalDocumentAdminReader);

    const reader = container.get<LegalDocumentAdminReader>(
      LEGAL_TYPES.LegalDocumentAdminReader,
    );

    expect((await reader.getVersion('terms', 1))?.publishedBy).toStrictEqual({
      id: DELETED_ADMIN_ID,
      nickname: null,
    });
  });
});
