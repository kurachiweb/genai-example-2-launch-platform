import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { HELP_CATEGORY_OTHER_ID } from '../../common-lib/help/help-category-constants.ts';
import type { CurrentAdmin } from '../../lib/core/admin/current-admin.ts';
import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearHelpTables,
  helpArticleIdOf,
  insertHelpArticle,
  T0,
} from '../../lib/workers/help/testing/help-fixtures.ts';
import {
  type HelpArticleAdminReader,
  StoreHelpArticleAdminReader,
} from '../application/help/help-article-admin-reader.ts';
import {
  type HelpArticleEditor,
  StoreHelpArticleEditor,
} from '../application/help/help-article-editor.ts';
import {
  DirectoryHelpAuthorLookup,
  type HelpAuthorLookup,
} from '../application/help/help-authors.ts';
import {
  type HelpCategoryService,
  StoreHelpCategoryService,
} from '../application/help/help-category-service.ts';
import { HELP_TYPES } from '../application/help/help-types.ts';
import { StorePublicHelpReader } from '../application/help/public-help-reader.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import { D1HelpArticleStore } from '../infrastructure/help/d1-help-article-store.ts';
import { D1HelpCategoryStore } from '../infrastructure/help/d1-help-category-store.ts';
import { D1PublicHelpStore } from '../infrastructure/help/d1-public-help-store.ts';
import { MODULES } from './modules.ts';

const MODERATOR = 1;

function createContainer(kind: InvocationScopeInfo['kind'] = 'fetch') {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: { kind, correlationId: crypto.randomUUID(), clientIp: undefined },
    },
    MODULES,
  );
}

const moderator = (): CurrentAdmin => ({
  id: adminIdOf(MODERATOR),
  role: 'moderator',
  nickname: '管理者1',
  sessionId: 'session-1',
});

beforeEach(async () => {
  await clearHelpTables();
  await clearAdminTables();
});

describe('APIサーバーのヘルプの束縛', () => {
  test('モジュールの一覧にヘルプのモジュールを1つだけ持つ', () => {
    expect(MODULES.filter(({ name }) => name === 'help')).toHaveLength(1);
  });

  test.each([
    ['HelpArticleStore', HELP_TYPES.HelpArticleStore, D1HelpArticleStore],
    ['HelpCategoryStore', HELP_TYPES.HelpCategoryStore, D1HelpCategoryStore],
    ['PublicHelpStore', HELP_TYPES.PublicHelpStore, D1PublicHelpStore],
    [
      'HelpAuthorLookup',
      HELP_TYPES.HelpAuthorLookup,
      DirectoryHelpAuthorLookup,
    ],
    ['HelpArticleEditor', HELP_TYPES.HelpArticleEditor, StoreHelpArticleEditor],
    [
      'HelpArticleAdminReader',
      HELP_TYPES.HelpArticleAdminReader,
      StoreHelpArticleAdminReader,
    ],
    [
      'HelpCategoryService',
      HELP_TYPES.HelpCategoryService,
      StoreHelpCategoryService,
    ],
    ['PublicHelpReader', HELP_TYPES.PublicHelpReader, StorePublicHelpReader],
  ] as const)(
    '処理単位のコンテナから%sを解決する',
    (_name, identifier, implementation) => {
      expect(createContainer().get(identifier)).toBeInstanceOf(implementation);
    },
  );

  test('定期実行の処理単位のコンテナもヘルプの束縛を含めて組み立てられる', () => {
    expect(
      createContainer('scheduled').get<HelpArticleAdminReader>(
        HELP_TYPES.HelpArticleAdminReader,
      ),
    ).toBeInstanceOf(StoreHelpArticleAdminReader);
  });

  test('束縛から取り出したカテゴリと記事の作成の後、管理者側の照会が作成者を付けた全件と使用可否を返す', async () => {
    await insertAdmin(MODERATOR, { role: 'moderator' });
    const container = createContainer();
    const categories = container.get<HelpCategoryService>(
      HELP_TYPES.HelpCategoryService,
    );
    const editor = container.get<HelpArticleEditor>(
      HELP_TYPES.HelpArticleEditor,
    );
    const reader = container.get<HelpArticleAdminReader>(
      HELP_TYPES.HelpArticleAdminReader,
    );
    // 作成者の管理者の行が無い記事は、作成者が削除された記事として扱われる
    await insertHelpArticle(1, { handle: 'orphan', updatedAt: T0 });

    const category = await categories.create(moderator(), { name: '使い方' });
    const created = await editor.create(
      moderator(),
      {
        handle: 'reset-password',
        title: 'パスワードを再設定する',
        subtitle: 'ログインできないときの手順',
        bodyMarkdown: '## 手順',
        categoryId: category.id,
        pinned: false,
        status: 'draft',
      },
      undefined,
    );

    const rows = await reader.listAll();
    expect(
      rows.map(({ id, categoryName, creator }) => ({
        id,
        categoryName,
        creator,
      })),
    ).toEqual([
      {
        id: created.id,
        categoryName: '使い方',
        creator: { nickname: '管理者1', title: null, avatarFileId: null },
      },
      { id: helpArticleIdOf(1), categoryName: 'その他', creator: null },
    ]);
    expect(rows[1]?.categoryId).toBe(HELP_CATEGORY_OTHER_ID);
    await expect(reader.find(created.id)).resolves.toMatchObject({
      id: created.id,
      bodyMarkdown: '## 手順',
      creator: { nickname: '管理者1' },
    });
    await expect(reader.checkHandle('Reset-Password', undefined)).resolves.toBe(
      'unavailable',
    );
    await expect(
      reader.checkHandle('Reset-Password', created.id),
    ).resolves.toBe('available');
  });

  test('作成者の照会は管理者の基盤の照会口を通して有効な管理者だけを返す', async () => {
    await insertAdmin(MODERATOR, { title: 'サポート' });
    const lookup = createContainer().get<HelpAuthorLookup>(
      HELP_TYPES.HelpAuthorLookup,
    );

    const authors = await lookup.find([adminIdOf(MODERATOR), adminIdOf(2)]);

    expect([...authors.entries()]).toEqual([
      [
        adminIdOf(MODERATOR),
        { nickname: '管理者1', title: 'サポート', avatarFileId: null },
      ],
    ]);
  });
});
