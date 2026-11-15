import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  EVENT_MEDIA_TYPES,
  type ModerationFindingsReader,
} from '../application/media/ports.ts';
import { D1ModerationFindingsReader } from '../infrastructure/media/d1-moderation-findings-reader.ts';
import { registerMediaSmokeRoutes } from '../presentation/media/media-smoke-routes.ts';
import type { EventEnv } from './env-schema.ts';

// 共通のメディアの束縛(createMediaPlatformModule)が登録されている前提で、動作確認の経路と判定の結果の読み出しだけを加える
export const MEDIA_SMOKE_MODULE: AppModule<Hono<PlatformHonoEnv<EventEnv>>> = {
  name: 'media-smoke',
  bindings: new ContainerModule(({ bind }) => {
    bind<ModerationFindingsReader>(
      EVENT_MEDIA_TYPES.ModerationFindingsReader,
    ).to(D1ModerationFindingsReader);
  }),
  routes: registerMediaSmokeRoutes,
};
