import { describe, expect, test } from 'bun:test';

import { EXPORT_SCHEMA_VERSION, README_TEXT } from '../archive-names.ts';
import { planArchive } from '../export-plan.ts';
import type { ExportFileView, ExportSnapshot } from '../export-snapshot.ts';
import {
  buildExportDocuments,
  serializeJson,
} from './build-export-documents.ts';

const AVATAR_ID = '01AVATAR0000000000000000A';
const LOGO_ID = '01LOGO000000000000000000A';
const ATTACHMENT_ID = '01ATTACH00000000000000000A';

const JSON_PATHS = [
  'account.json',
  'profile.json',
  'products.json',
  'launches.json',
  'comments.json',
  'upvotes.json',
  'ratings.json',
  'follows.json',
  'reports.json',
  'inquiries.json',
  'sponsorships.json',
  'payments.json',
];

function view(fileId: string, name: string): ExportFileView {
  return {
    fileId,
    originalFileName: name,
    contentType: 'image/png',
    byteSize: 100,
    quarantined: false,
  };
}

function snapshot(overrides: Partial<ExportSnapshot> = {}): ExportSnapshot {
  const product = {
    id: 'P1',
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    tagline: 'メモ',
    categoryName: 'ツール',
    websiteUrl: 'https://pitch.example',
    descriptionMarkdown: '# 説明',
    logoFileId: LOGO_ID,
    screenshotFileIds: [],
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
    deletedAt: null,
    hiddenByAdmin: false,
  };
  return {
    requestedAt: new Date('2026-09-15T10:12:30.000Z'),
    account: {
      email: 'kurachi@mail.example',
      emailVerifiedAt: null,
      registeredAt: new Date('2026-03-01T23:58:41.000Z'),
      mfaEnabled: false,
      plan: null,
      notificationSettings: null,
      apiKeys: [],
    },
    profile: {
      handle: 'KurachiWeb',
      nickname: 'くらち',
      headline: null,
      bioMarkdown: '自己紹介',
      avatarFileId: AVATAR_ID,
      websites: [],
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    },
    products: [product],
    launches: [],
    comments: [
      {
        id: 'C1',
        launchId: 'L1',
        product: { name: 'Pitch Notes', handle: 'pitch-notes' },
        parentCommentId: null,
        bodyMarkdown: 'コメント',
        createdAt: new Date('2026-04-03T00:00:00.000Z'),
        editedAt: null,
        deletedAt: null,
        hiddenByAdmin: false,
      },
    ],
    upvotes: [],
    ratings: [],
    follows: [],
    reports: [],
    inquiries: [
      {
        id: 'Q1',
        category: 'その他',
        status: 'open',
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
        messages: [
          {
            id: 'M1',
            sender: 'user',
            adminNickname: null,
            body: '質問',
            attachments: [
              {
                fileId: ATTACHMENT_ID,
                originalFileName: 'receipt.pdf',
                contentType: 'application/pdf',
                size: 10,
              },
            ],
            createdAt: new Date('2026-08-01T10:00:00.000Z'),
          },
        ],
      },
    ],
    sponsorships: [],
    payments: [],
    files: new Map([
      [AVATAR_ID, view(AVATAR_ID, 'me.png')],
      [LOGO_ID, view(LOGO_ID, 'logo.png')],
      [ATTACHMENT_ID, view(ATTACHMENT_ID, 'receipt.pdf')],
    ]),
    ...overrides,
  };
}

function build(
  value: ExportSnapshot,
  stored: readonly string[] = [AVATAR_ID, LOGO_ID, ATTACHMENT_ID],
) {
  return buildExportDocuments({
    snapshot: value,
    plan: planArchive(value),
    stored: new Set(stored),
  });
}

function parsed(documents: ReturnType<typeof build>, path: string): unknown {
  return JSON.parse(textOf(documents, path));
}

function textOf(documents: ReturnType<typeof build>, path: string): string {
  const file = documents.files.find((entry) => entry.path === path);
  if (file === undefined) {
    throw new Error(`出力に無い: ${path}`);
  }
  return file.text;
}

describe('serializeJson', () => {
  test('2スペースの字下げ・LF・末尾の改行で書き、BOMを付けない', () => {
    const text = serializeJson({ a: [1, { b: null }] });

    expect(text).toBe(
      '{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ]\n}\n',
    );
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).not.toContain('\r');
  });

  test('空配列は[]に末尾の改行を付ける', () => {
    expect(serializeJson([])).toBe('[]\n');
  });

  test('日本語と絵文字をエスケープせずに書く', () => {
    expect(serializeJson('あ😀')).toBe('"あ😀"\n');
  });
});

describe('buildExportDocuments', () => {
  test('README.txt・manifest.json・12のJSON・マークダウンの全てを返す', () => {
    const documents = build(snapshot());

    expect(documents.files.map((file) => file.path).sort()).toStrictEqual(
      [
        'README.txt',
        'manifest.json',
        ...JSON_PATHS,
        'comments/C1.md',
        'products/pitch-notes/description.md',
        'profile/bio.md',
      ].sort(),
    );
  });

  test('パスは重複しない', () => {
    const paths = build(snapshot()).files.map((file) => file.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  test('マークダウンは計画の本文をそのまま返す', () => {
    const documents = build(snapshot());

    expect(textOf(documents, 'comments/C1.md')).toBe('コメント');
    expect(textOf(documents, 'profile/bio.md')).toBe('自己紹介');
    expect(textOf(documents, 'products/pitch-notes/description.md')).toBe(
      '# 説明',
    );
  });

  test('README.txtは定めた文面をそのまま返す', () => {
    expect(textOf(build(snapshot()), 'README.txt')).toBe(README_TEXT);
  });

  test('全てのJSONはLF・末尾の改行ありでBOMが無く、読み戻せる', () => {
    const documents = build(snapshot());

    for (const path of ['manifest.json', ...JSON_PATHS]) {
      const text = textOf(documents, path);
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
      expect(text).not.toContain('\r');
      expect(text.charCodeAt(0)).not.toBe(0xfeff);
      expect(() => {
        JSON.parse(text);
      }).not.toThrow();
    }
  });

  test('manifestは文書の順に12のJSONを並べ、件数は配列の要素数にする', () => {
    const documents = build(snapshot());

    expect(JSON.parse(textOf(documents, 'manifest.json'))).toStrictEqual({
      schemaVersion: EXPORT_SCHEMA_VERSION,
      service: 'Launch Stadium',
      requestedAt: '2026-09-15T10:12:30.000Z',
      user: { handle: 'KurachiWeb' },
      files: [
        { path: 'account.json', kind: 'account', count: 1 },
        { path: 'profile.json', kind: 'profile', count: 1 },
        { path: 'products.json', kind: 'products', count: 1 },
        { path: 'launches.json', kind: 'launches', count: 0 },
        { path: 'comments.json', kind: 'comments', count: 1 },
        { path: 'upvotes.json', kind: 'upvotes', count: 0 },
        { path: 'ratings.json', kind: 'ratings', count: 0 },
        { path: 'follows.json', kind: 'follows', count: 0 },
        { path: 'reports.json', kind: 'reports', count: 0 },
        { path: 'inquiries.json', kind: 'inquiries', count: 1 },
        { path: 'sponsorships.json', kind: 'sponsorships', count: 0 },
        { path: 'payments.json', kind: 'payments', count: 0 },
      ],
    });
  });

  test('0件のJSONは空配列で出力し、accountとprofileは配列にしない', () => {
    const documents = build(snapshot());

    expect(JSON.parse(textOf(documents, 'payments.json'))).toStrictEqual([]);
    expect(Array.isArray(JSON.parse(textOf(documents, 'account.json')))).toBe(
      false,
    );
    expect(Array.isArray(JSON.parse(textOf(documents, 'profile.json')))).toBe(
      false,
    );
  });

  test('JSONの添付のパスは格納できたファイルとだけ一致する', () => {
    const stored = build(snapshot());
    const notStored = build(snapshot(), [AVATAR_ID, LOGO_ID]);

    const attachmentOf = (documents: ReturnType<typeof build>): unknown =>
      JSON.parse(textOf(documents, 'inquiries.json'));
    expect(attachmentOf(stored)).toMatchObject([
      {
        messages: [{ attachments: [{ path: 'inquiries/Q1/M1/receipt.pdf' }] }],
      },
    ]);
    expect(attachmentOf(notStored)).toMatchObject([
      { messages: [{ attachments: [{ path: null }] }] },
    ]);
    expect(parsed(notStored, 'profile.json')).toMatchObject({
      avatarPath: 'profile/avatar/me.png',
    });
    expect(parsed(build(snapshot(), []), 'profile.json')).toMatchObject({
      avatarPath: null,
    });
  });

  test('生成時点のハンドルをmanifestとprofile.jsonに書く', () => {
    const documents = build(
      snapshot({
        profile: { ...snapshot().profile, handle: 'renamed-handle' },
      }),
    );

    expect(parsed(documents, 'manifest.json')).toMatchObject({
      user: { handle: 'renamed-handle' },
    });
    expect(parsed(documents, 'profile.json')).toMatchObject({
      handle: 'renamed-handle',
    });
  });

  test('自己紹介が無ければprofile/bio.mdを出さない', () => {
    const documents = build(
      snapshot({ profile: { ...snapshot().profile, bioMarkdown: null } }),
    );

    expect(documents.files.map((file) => file.path)).not.toContain(
      'profile/bio.md',
    );
  });

  test('空のスナップショットでも12のJSONが揃う', () => {
    const empty = snapshot({
      products: [],
      comments: [],
      inquiries: [],
      files: new Map(),
      profile: { ...snapshot().profile, bioMarkdown: null, avatarFileId: null },
    });

    const paths = build(empty, []).files.map((file) => file.path);

    expect(paths.sort()).toStrictEqual(
      ['README.txt', 'manifest.json', ...JSON_PATHS].sort(),
    );
  });

  test('出力の順はJSON・マークダウン・manifest・READMEとする', () => {
    const paths = build(snapshot()).files.map((file) => file.path);

    expect(paths.slice(0, 12)).toStrictEqual(JSON_PATHS);
    expect(paths.slice(-2)).toStrictEqual(['manifest.json', 'README.txt']);
  });
});
