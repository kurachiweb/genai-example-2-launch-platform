import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  DefaultSponsorshipApplication,
  type SponsorshipApplication,
} from '../application/sponsorship/sponsorship-application.ts';
import { SPONSORSHIP_TYPES } from '../application/sponsorship/sponsorship-types.ts';

// スポンサー広告の共通の束縛(createSponsorshipPlatformModule)と、利用者の確認・決済の開始の束縛は他のモジュールの束縛を使う
export const SPONSORSHIP_API_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'api-sponsorship',
  bindings: new ContainerModule(({ bind }) => {
    bind<SponsorshipApplication>(SPONSORSHIP_TYPES.SponsorshipApplication).to(
      DefaultSponsorshipApplication,
    );
  }),
};
