import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import {
  commentBodyPathOf,
  planArchive,
  PROFILE_BIO_PATH,
  productDescriptionPathOf,
} from './export-plan.ts';
import type {
  ExportComment,
  ExportFileView,
  ExportInquiry,
  ExportProduct,
  ExportSnapshot,
} from './export-snapshot.ts';

const AT = new Date('2026-09-15T10:12:30.000Z');

function fileView(
  fileId: string,
  originalFileName: string,
  quarantined = false,
): ExportFileView {
  return {
    fileId,
    originalFileName,
    contentType: 'image/png',
    byteSize: 100,
    quarantined,
  };
}

function product(overrides: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: '01PRODUCT0000000000000000A',
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    tagline: 'tagline',
    categoryName: 'AI',
    websiteUrl: 'https://pitch-notes.example/',
    descriptionMarkdown: '説明文',
    logoFileId: 'logo-1',
    screenshotFileIds: [],
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    hiddenByAdmin: false,
    ...overrides,
  };
}

function comment(id: string, bodyMarkdown = '本文'): ExportComment {
  return {
    id,
    launchId: 'launch-1',
    product: null,
    parentCommentId: null,
    bodyMarkdown,
    createdAt: AT,
    editedAt: null,
    deletedAt: null,
    hiddenByAdmin: false,
  };
}

function inquiry(
  id: string,
  messages: readonly {
    readonly id: string;
    readonly attachments: readonly { fileId: string; name: string }[];
  }[],
): ExportInquiry {
  return {
    id,
    category: 'その他',
    status: 'open',
    createdAt: AT,
    messages: messages.map((message) => ({
      id: message.id,
      sender: 'user',
      adminNickname: null,
      body: '本文',
      createdAt: AT,
      attachments: message.attachments.map((attachment) => ({
        fileId: attachment.fileId,
        originalFileName: attachment.name,
        contentType: 'application/pdf',
        size: 10,
      })),
    })),
  };
}

function snapshot(
  overrides: Partial<ExportSnapshot> = {},
  views: readonly ExportFileView[] = [],
): ExportSnapshot {
  return {
    requestedAt: AT,
    account: {
      email: 'user@mail.example',
      emailVerifiedAt: AT,
      registeredAt: AT,
      mfaEnabled: false,
      plan: null,
      notificationSettings: null,
      apiKeys: [],
    },
    profile: {
      handle: 'KurachiWeb',
      nickname: 'Kurachi',
      headline: null,
      bioMarkdown: null,
      avatarFileId: null,
      websites: [],
      updatedAt: AT,
    },
    products: [],
    launches: [],
    comments: [],
    upvotes: [],
    ratings: [],
    follows: [],
    reports: [],
    inquiries: [],
    sponsorships: [],
    payments: [],
    files: new Map(views.map((view) => [view.fileId, view])),
    ...overrides,
  };
}

describe('planArchive のバイナリのパス', () => {
  test('プロフィール画像・ロゴ・スクリーンショット・添付を文書のパスに置く', () => {
    const plan = planArchive(
      snapshot(
        {
          profile: { ...snapshot().profile, avatarFileId: 'avatar-1' },
          products: [
            product({
              logoFileId: 'logo-1',
              screenshotFileIds: ['shot-1', 'shot-2'],
            }),
          ],
          inquiries: [
            inquiry('INQ1', [
              {
                id: 'MSG1',
                attachments: [{ fileId: 'att-1', name: 'receipt.pdf' }],
              },
            ]),
          ],
        },
        [
          fileView('avatar-1', 'avatar.png'),
          fileView('logo-1', 'logo.png'),
          fileView('shot-1', 'home.png'),
          fileView('shot-2', 'detail.png'),
          fileView('att-1', 'receipt.pdf'),
        ],
      ),
    );

    expect(plan.binaries).toEqual([
      { fileId: 'avatar-1', path: 'profile/avatar/avatar.png' },
      { fileId: 'logo-1', path: 'products/pitch-notes/logo/logo.png' },
      { fileId: 'shot-1', path: 'products/pitch-notes/screenshots/home.png' },
      {
        fileId: 'shot-2',
        path: 'products/pitch-notes/screenshots/detail.png',
      },
      { fileId: 'att-1', path: 'inquiries/INQ1/MSG1/receipt.pdf' },
    ]);
  });

  test('スクリーンショットは表示の順に並べる', () => {
    const plan = planArchive(
      snapshot(
        {
          products: [
            product({ logoFileId: 'none', screenshotFileIds: ['b', 'a', 'c'] }),
          ],
        },
        [
          fileView('a', 'a.png'),
          fileView('b', 'b.png'),
          fileView('c', 'c.png'),
        ],
      ),
    );

    expect(plan.binaries.map((binary) => binary.fileId)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  test('プロフィール・プロダクト・問い合わせの順に並べ、プロダクトは作成の順に並べる', () => {
    const plan = planArchive(
      snapshot(
        {
          profile: { ...snapshot().profile, avatarFileId: 'avatar-1' },
          products: [
            product({ id: 'P1', handle: 'first', logoFileId: 'logo-1' }),
            product({ id: 'P2', handle: 'second', logoFileId: 'logo-2' }),
          ],
          inquiries: [
            inquiry('INQ1', [
              { id: 'M1', attachments: [{ fileId: 'att-1', name: 'a.pdf' }] },
            ]),
          ],
        },
        [
          fileView('att-1', 'a.pdf'),
          fileView('logo-2', 'l.png'),
          fileView('logo-1', 'l.png'),
          fileView('avatar-1', 'v.png'),
        ],
      ),
    );

    expect(plan.binaries.map((binary) => binary.fileId)).toEqual([
      'avatar-1',
      'logo-1',
      'logo-2',
      'att-1',
    ]);
  });

  test('隔離中のファイルは格納の対象から除く', () => {
    const plan = planArchive(
      snapshot(
        {
          profile: { ...snapshot().profile, avatarFileId: 'avatar-1' },
          products: [
            product({ logoFileId: 'logo-1', screenshotFileIds: ['shot-1'] }),
          ],
          inquiries: [
            inquiry('INQ1', [
              { id: 'M1', attachments: [{ fileId: 'att-1', name: 'a.pdf' }] },
            ]),
          ],
        },
        [
          fileView('avatar-1', 'avatar.png', true),
          fileView('logo-1', 'logo.png', true),
          fileView('shot-1', 'home.png'),
          fileView('att-1', 'a.pdf', true),
        ],
      ),
    );

    expect(plan.binaries).toEqual([
      { fileId: 'shot-1', path: 'products/pitch-notes/screenshots/home.png' },
    ]);
    expect(plan.pathByFileId.has('avatar-1')).toBe(false);
  });

  test('ファイルの記録が無いものは格納の対象から除く', () => {
    const plan = planArchive(
      snapshot(
        {
          profile: { ...snapshot().profile, avatarFileId: 'avatar-1' },
          products: [
            product({ logoFileId: 'logo-1', screenshotFileIds: ['shot-1'] }),
          ],
          inquiries: [
            inquiry('INQ1', [
              { id: 'M1', attachments: [{ fileId: 'att-1', name: 'a.pdf' }] },
            ]),
          ],
        },
        [],
      ),
    );

    expect(plan.binaries).toEqual([]);
    expect(plan.pathByFileId.size).toBe(0);
  });

  test('同じディレクトリの同名のファイルに大文字小文字を区別せず-2からの連番を付ける', () => {
    const plan = planArchive(
      snapshot(
        {
          products: [
            product({
              logoFileId: 'none',
              screenshotFileIds: ['s1', 's2', 's3', 's4'],
            }),
          ],
        },
        [
          fileView('s1', 'shot.png'),
          fileView('s2', 'SHOT.png'),
          fileView('s3', 'shot.png'),
          fileView('s4', 'shot-2.png'),
        ],
      ),
    );

    expect(plan.binaries.map((binary) => binary.path)).toEqual([
      'products/pitch-notes/screenshots/shot.png',
      'products/pitch-notes/screenshots/SHOT-2.png',
      'products/pitch-notes/screenshots/shot-3.png',
      'products/pitch-notes/screenshots/shot-2-2.png',
    ]);
  });

  test('異なるディレクトリの同名のファイルには連番を付けない', () => {
    const plan = planArchive(
      snapshot(
        {
          profile: { ...snapshot().profile, avatarFileId: 'avatar-1' },
          products: [
            product({ id: 'P1', handle: 'one', logoFileId: 'logo-1' }),
            product({ id: 'P2', handle: 'two', logoFileId: 'logo-2' }),
          ],
        },
        [
          fileView('avatar-1', 'image.png'),
          fileView('logo-1', 'image.png'),
          fileView('logo-2', 'image.png'),
        ],
      ),
    );

    expect(plan.binaries.map((binary) => binary.path)).toEqual([
      'profile/avatar/image.png',
      'products/one/logo/image.png',
      'products/two/logo/image.png',
    ]);
  });

  test('問い合わせの添付はメッセージごとのディレクトリに置き、同じメッセージの同名には連番を付ける', () => {
    const plan = planArchive(
      snapshot(
        {
          inquiries: [
            inquiry('INQ1', [
              {
                id: 'M1',
                attachments: [
                  { fileId: 'a1', name: 'doc.pdf' },
                  { fileId: 'a2', name: 'doc.pdf' },
                ],
              },
              { id: 'M2', attachments: [{ fileId: 'a3', name: 'doc.pdf' }] },
            ]),
          ],
        },
        [
          fileView('a1', 'doc.pdf'),
          fileView('a2', 'doc.pdf'),
          fileView('a3', 'doc.pdf'),
        ],
      ),
    );

    expect(plan.binaries.map((binary) => binary.path)).toEqual([
      'inquiries/INQ1/M1/doc.pdf',
      'inquiries/INQ1/M1/doc-2.pdf',
      'inquiries/INQ1/M2/doc.pdf',
    ]);
  });

  test('ファイル名の変換を元のファイル名に適用する', () => {
    const plan = planArchive(
      snapshot(
        {
          products: [
            product({
              logoFileId: 'l',
              screenshotFileIds: ['s1', 's2'],
            }),
          ],
        },
        [
          fileView('l', 'a:b*c.png'),
          fileView('s1', 'CON.png'),
          fileView('s2', 'name. .png'),
        ],
      ),
    );

    expect(plan.binaries.map((binary) => binary.path)).toEqual([
      'products/pitch-notes/logo/a-b-c.png',
      'products/pitch-notes/screenshots/CON_.png',
      'products/pitch-notes/screenshots/name.png',
    ]);
  });

  test('ファイル名に含まれるパスの区切りを置換し、ディレクトリの外へ出さない', () => {
    const plan = planArchive(
      snapshot(
        {
          products: [
            product({ logoFileId: 'l', screenshotFileIds: ['s1', 's2'] }),
          ],
        },
        [
          fileView('l', '../../evil.png'),
          fileView('s1', 'a\\b.png'),
          fileView('s2', '..'),
        ],
      ),
    );

    for (const binary of plan.binaries) {
      const fileName = binary.path.slice(binary.path.lastIndexOf('/') + 1);
      expect(fileName).not.toContain('/');
      expect(fileName).not.toContain('\\');
      expect(['.', '..']).not.toContain(fileName);
    }
    expect(plan.binaries.map((binary) => binary.path)).toEqual([
      'products/pitch-notes/logo/..-..-evil.png',
      'products/pitch-notes/screenshots/a-b.png',
      'products/pitch-notes/screenshots/file',
    ]);
  });

  test('日本語のファイル名をそのまま使う', () => {
    const plan = planArchive(
      snapshot({ profile: { ...snapshot().profile, avatarFileId: 'a' } }, [
        fileView('a', 'アイコン🙂.png'),
      ]),
    );

    expect(plan.binaries[0]?.path).toBe('profile/avatar/アイコン🙂.png');
  });

  test('同じファイルIDは1回だけ格納し、同じパスを共有する', () => {
    const plan = planArchive(
      snapshot(
        {
          products: [
            product({
              logoFileId: 'dup',
              screenshotFileIds: ['dup', 'other'],
            }),
          ],
        },
        [fileView('dup', 'a.png'), fileView('other', 'b.png')],
      ),
    );

    expect(plan.binaries).toEqual([
      { fileId: 'dup', path: 'products/pitch-notes/logo/a.png' },
      { fileId: 'other', path: 'products/pitch-notes/screenshots/b.png' },
    ]);
    expect(plan.pathByFileId.get('dup')).toBe(
      'products/pitch-notes/logo/a.png',
    );
  });

  test('pathByFileIdはbinariesと同じ対応を持つ', () => {
    const plan = planArchive(
      snapshot({ profile: { ...snapshot().profile, avatarFileId: 'a' } }, [
        fileView('a', 'x.png'),
      ]),
    );

    expect(plan.pathByFileId).toEqual(new Map([['a', 'profile/avatar/x.png']]));
  });

  test('ファイルが無ければ空の計画を返しディレクトリを作らない', () => {
    const plan = planArchive(snapshot());

    expect(plan.binaries).toEqual([]);
    expect(plan.markdown).toEqual([]);
    expect(plan.productDirectories.size).toBe(0);
  });

  test('ファイルの実体のある添付だけのディレクトリを作る', () => {
    const plan = planArchive(
      snapshot(
        {
          inquiries: [
            inquiry('INQ1', [
              { id: 'M1', attachments: [{ fileId: 'q', name: 'q.pdf' }] },
              { id: 'M2', attachments: [] },
            ]),
          ],
        },
        [fileView('q', 'q.pdf', true)],
      ),
    );

    expect(plan.binaries).toEqual([]);
  });

  test('大量のファイルでも計画できる', () => {
    const ids = Array.from(
      { length: 10_000 },
      (_, index) => `f${String(index)}`,
    );
    const plan = planArchive(
      snapshot(
        { products: [product({ logoFileId: 'none', screenshotFileIds: ids })] },
        ids.map((id) => fileView(id, 'shot.png')),
      ),
    );

    expect(plan.binaries).toHaveLength(10_000);
    expect(new Set(plan.binaries.map((b) => b.path.toLowerCase())).size).toBe(
      10_000,
    );
  });
});

describe('planArchive のプロダクトのディレクトリ', () => {
  test('論理削除済みを含めて、生成時点のハンドルをディレクトリ名にする', () => {
    const plan = planArchive(
      snapshot({
        products: [
          product({ id: 'P1', handle: 'alive' }),
          product({ id: 'P2', handle: 'gone', deletedAt: AT }),
        ],
      }),
    );

    expect(plan.productDirectories).toEqual(
      new Map([
        ['P1', 'products/alive'],
        ['P2', 'products/gone'],
      ]),
    );
  });

  test('大文字小文字を区別しない衝突に-2からの連番を付ける', () => {
    const plan = planArchive(
      snapshot({
        products: [
          product({ id: 'P1', handle: 'pitch-notes' }),
          product({ id: 'P2', handle: 'Pitch-Notes', deletedAt: AT }),
          product({ id: 'P3', handle: 'pitch-notes' }),
        ],
      }),
    );

    expect([...plan.productDirectories.values()]).toEqual([
      'products/pitch-notes',
      'products/Pitch-Notes-2',
      'products/pitch-notes-3',
    ]);
  });

  test('連番の名前が別のハンドルと衝突するなら衝突しなくなるまで増やす', () => {
    const plan = planArchive(
      snapshot({
        products: [
          product({ id: 'P1', handle: 'pitch-notes' }),
          product({ id: 'P2', handle: 'pitch-notes-2' }),
          product({ id: 'P3', handle: 'pitch-notes' }),
        ],
      }),
    );

    expect([...plan.productDirectories.values()]).toEqual([
      'products/pitch-notes',
      'products/pitch-notes-2',
      'products/pitch-notes-3',
    ]);
  });

  test('連番を付けたディレクトリの下にファイルを置く', () => {
    const plan = planArchive(
      snapshot(
        {
          products: [
            product({ id: 'P1', handle: 'dup', logoFileId: 'l1' }),
            product({ id: 'P2', handle: 'DUP', logoFileId: 'l2' }),
          ],
        },
        [fileView('l1', 'logo.png'), fileView('l2', 'logo.png')],
      ),
    );

    expect(plan.binaries.map((binary) => binary.path)).toEqual([
      'products/dup/logo/logo.png',
      'products/DUP-2/logo/logo.png',
    ]);
  });

  test('ファイルが無いプロダクトでも説明文のためにディレクトリを割り当てる', () => {
    const plan = planArchive(snapshot({ products: [product({ id: 'P1' })] }));

    expect(plan.productDirectories.get('P1')).toBe('products/pitch-notes');
  });
});

describe('planArchive のマークダウン', () => {
  test('自己紹介・プロダクトの説明文・コメントを文書のパスに置く', () => {
    const plan = planArchive(
      snapshot({
        profile: { ...snapshot().profile, bioMarkdown: '# 自己紹介' },
        products: [
          product({ id: 'P1', handle: 'one', descriptionMarkdown: '説明1' }),
          product({ id: 'P2', handle: 'two', descriptionMarkdown: '説明2' }),
        ],
        comments: [comment('C1', 'こんにちは'), comment('C2', '返信')],
      }),
    );

    expect(plan.markdown).toEqual([
      { path: 'profile/bio.md', text: '# 自己紹介' },
      { path: 'products/one/description.md', text: '説明1' },
      { path: 'products/two/description.md', text: '説明2' },
      { path: 'comments/C1.md', text: 'こんにちは' },
      { path: 'comments/C2.md', text: '返信' },
    ]);
  });

  test.each([[null], ['']])('自己紹介が%sなら書かない', (bioMarkdown) => {
    const plan = planArchive(
      snapshot({ profile: { ...snapshot().profile, bioMarkdown } }),
    );

    expect(plan.markdown).toEqual([]);
  });

  test('本文をそのまま書き、削除済み・非公開のコメントと空の説明文も含める', () => {
    const plan = planArchive(
      snapshot({
        products: [product({ id: 'P1', descriptionMarkdown: '' })],
        comments: [
          {
            ...comment('C1', '  前後の空白と\r\n改行 '),
            deletedAt: AT,
            hiddenByAdmin: true,
          },
        ],
      }),
    );

    expect(plan.markdown).toEqual([
      { path: 'products/pitch-notes/description.md', text: '' },
      { path: 'comments/C1.md', text: '  前後の空白と\r\n改行 ' },
    ]);
  });

  test('説明文のパスはファイルの有無に関わらず連番のディレクトリの下に置く', () => {
    const plan = planArchive(
      snapshot({
        products: [
          product({ id: 'P1', handle: 'a' }),
          product({ id: 'P2', handle: 'A' }),
        ],
      }),
    );

    expect(plan.markdown.map((file) => file.path)).toEqual([
      'products/a/description.md',
      'products/A-2/description.md',
    ]);
  });
});

describe('パスの補助', () => {
  test('文書のパスを返す', () => {
    expect(PROFILE_BIO_PATH).toBe('profile/bio.md');
    expect(productDescriptionPathOf('products/pitch-notes')).toBe(
      'products/pitch-notes/description.md',
    );
    expect(commentBodyPathOf('01J9F6C8H0K2M4P6R8T0V2X4Z6')).toBe(
      'comments/01J9F6C8H0K2M4P6R8T0V2X4Z6.md',
    );
  });
});

describe('スナップショットの型・計画・書式の補助の依存', () => {
  const directory = dirname(new URL(import.meta.url).pathname);
  const files = [
    join(directory, 'export-snapshot.ts'),
    join(directory, 'export-plan.ts'),
    join(directory, 'documents', 'export-formats.ts'),
  ];
  const ALLOWED_SPECIFIERS = new Set([
    './archive-names.ts',
    './export-snapshot.ts',
    '../export-snapshot.ts',
    '../../time/business-time.ts',
  ]);

  test.each(files)('%sは上流のドメインの型を読み込まない', (file) => {
    const source = readFileSync(file, 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map(
      (match) => match[1] ?? '',
    );

    for (const specifier of specifiers) {
      expect(ALLOWED_SPECIFIERS.has(specifier)).toBe(true);
    }
  });
});
