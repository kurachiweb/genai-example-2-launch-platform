import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
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
import type {
  HelpArticleStore,
  HelpCategoryStore,
} from '../application/help/ports.ts';
import { D1HelpArticleStore } from '../infrastructure/help/d1-help-article-store.ts';
import { D1HelpCategoryStore } from '../infrastructure/help/d1-help-category-store.ts';

// 管理者の照会口・監査ログの記録(ADMIN_PLATFORM_MODULE)と索引の更新の要求・索引の文(API_SEARCH_PLATFORM_MODULE)は各基盤のモジュールの束縛を使う
export const HELP_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'help',
  bindings: new ContainerModule(({ bind }) => {
    bind<HelpArticleStore>(HELP_TYPES.HelpArticleStore).to(D1HelpArticleStore);
    bind<HelpCategoryStore>(HELP_TYPES.HelpCategoryStore).to(
      D1HelpCategoryStore,
    );
    bind<HelpAuthorLookup>(HELP_TYPES.HelpAuthorLookup).to(
      DirectoryHelpAuthorLookup,
    );
    bind<HelpArticleEditor>(HELP_TYPES.HelpArticleEditor).to(
      StoreHelpArticleEditor,
    );
    bind<HelpArticleAdminReader>(HELP_TYPES.HelpArticleAdminReader).to(
      StoreHelpArticleAdminReader,
    );
    bind<HelpCategoryService>(HELP_TYPES.HelpCategoryService).to(
      StoreHelpCategoryService,
    );
  }),
};
