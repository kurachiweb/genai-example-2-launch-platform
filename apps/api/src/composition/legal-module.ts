import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type LegalDocumentAdminReader,
  StoreLegalDocumentAdminReader,
} from '../application/legal/legal-document-admin-reader.ts';
import {
  type LegalDocumentPublisher,
  StoreLegalDocumentPublisher,
} from '../application/legal/legal-document-publisher.ts';
import {
  type LegalDocumentReader,
  StoreLegalDocumentReader,
} from '../application/legal/legal-document-reader.ts';
import {
  type LegalDraftEditor,
  StoreLegalDraftEditor,
} from '../application/legal/legal-draft-editor.ts';
import { LEGAL_TYPES } from '../application/legal/legal-types.ts';
import {
  type LegalVersionLocator,
  StoreLegalVersionLocator,
} from '../application/legal/legal-version-locator.ts';
import type { LegalDocumentStore } from '../application/legal/ports.ts';
import { D1LegalDocumentStore } from '../infrastructure/legal/d1-legal-document-store.ts';

// 管理の照会が使う管理者の照会口(ADMIN_PLATFORM_TYPES.AdminDirectory)は管理者の基盤のモジュールの束縛を使う
export const LEGAL_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'legal',
  bindings: new ContainerModule(({ bind }) => {
    bind<LegalDocumentStore>(LEGAL_TYPES.LegalDocumentStore).to(
      D1LegalDocumentStore,
    );
    bind<LegalDocumentReader>(LEGAL_TYPES.LegalDocumentReader).to(
      StoreLegalDocumentReader,
    );
    bind<LegalDocumentAdminReader>(LEGAL_TYPES.LegalDocumentAdminReader).to(
      StoreLegalDocumentAdminReader,
    );
    bind<LegalDraftEditor>(LEGAL_TYPES.LegalDraftEditor).to(
      StoreLegalDraftEditor,
    );
    bind<LegalDocumentPublisher>(LEGAL_TYPES.LegalDocumentPublisher).to(
      StoreLegalDocumentPublisher,
    );
    bind<LegalVersionLocator>(LEGAL_TYPES.LegalVersionLocator).to(
      StoreLegalVersionLocator,
    );
  }),
};
