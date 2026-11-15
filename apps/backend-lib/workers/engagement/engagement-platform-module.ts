import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../core/engagement/identifiers.ts';
import type {
  AdminCommentDirectory,
  AdminRatingDirectory,
  CommentExport,
  CommentStore,
  CommentThreadQuery,
  EngagementErasureStore,
  RatingExport,
  RatingStore,
} from '../../core/engagement/ports.ts';
import {
  type CommentStatements,
  D1CommentStatements,
} from './comment-statements.ts';
import { D1AdminCommentDirectory } from './d1-admin-comment-directory.ts';
import { D1AdminRatingDirectory } from './d1-admin-rating-directory.ts';
import { D1CommentStore } from './d1-comment-store.ts';
import { D1CommentThreadQuery } from './d1-comment-thread-query.ts';
import { D1EngagementErasureStore } from './d1-engagement-erasure-store.ts';
import { D1CommentExport, D1RatingExport } from './d1-engagement-export.ts';
import { D1RatingStore } from './d1-rating-store.ts';
import {
  D1RatingStatements,
  type RatingStatements,
} from './rating-statements.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const ENGAGEMENT_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'engagement-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<CommentStore>(ENGAGEMENT_PLATFORM_TYPES.CommentStore)
      .to(D1CommentStore)
      .inSingletonScope();
    bind<CommentStatements>(ENGAGEMENT_PLATFORM_TYPES.CommentStatements)
      .to(D1CommentStatements)
      .inSingletonScope();
    bind<CommentThreadQuery>(ENGAGEMENT_PLATFORM_TYPES.CommentThreadQuery)
      .to(D1CommentThreadQuery)
      .inSingletonScope();
    bind<RatingStore>(ENGAGEMENT_PLATFORM_TYPES.RatingStore)
      .to(D1RatingStore)
      .inSingletonScope();
    bind<RatingStatements>(ENGAGEMENT_PLATFORM_TYPES.RatingStatements)
      .to(D1RatingStatements)
      .inSingletonScope();
    bind<EngagementErasureStore>(
      ENGAGEMENT_PLATFORM_TYPES.EngagementErasureStore,
    )
      .to(D1EngagementErasureStore)
      .inSingletonScope();
    bind<CommentExport>(ENGAGEMENT_PLATFORM_TYPES.CommentExport)
      .to(D1CommentExport)
      .inSingletonScope();
    bind<RatingExport>(ENGAGEMENT_PLATFORM_TYPES.RatingExport)
      .to(D1RatingExport)
      .inSingletonScope();
    bind<AdminCommentDirectory>(ENGAGEMENT_PLATFORM_TYPES.AdminCommentDirectory)
      .to(D1AdminCommentDirectory)
      .inSingletonScope();
    bind<AdminRatingDirectory>(ENGAGEMENT_PLATFORM_TYPES.AdminRatingDirectory)
      .to(D1AdminRatingDirectory)
      .inSingletonScope();
  }),
};
