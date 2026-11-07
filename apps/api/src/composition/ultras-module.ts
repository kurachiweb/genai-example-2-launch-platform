import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createUltrasPlatformModule } from '../../lib/workers/ultras/ultras-platform-module.ts';
import type { PortalSessionLimits } from '../application/ultras/portal-ports.ts';
import {
  DefaultPortalSessionStarter,
  type PortalSessionStarter,
} from '../application/ultras/portal-session-starter.ts';
import type {
  PromotionSettingReader,
  PromotionSettingWriter,
} from '../application/ultras/promotion-setting-ports.ts';
import {
  DefaultPromotionSettingService,
  type PromotionSettingService,
} from '../application/ultras/promotion-setting-service.ts';
import {
  DefaultUltrasCheckout,
  type UltrasCheckout,
} from '../application/ultras/ultras-checkout.ts';
import {
  DefaultUltrasPlanReader,
  type UltrasPlanReader,
} from '../application/ultras/ultras-plan-reader.ts';
import { API_ULTRAS_TYPES } from '../application/ultras/ultras-types.ts';
import { CounterPortalSessionLimits } from '../infrastructure/ultras/counter-portal-session-limits.ts';
import { D1PromotionSettingWriter } from '../infrastructure/ultras/d1-promotion-setting-writer.ts';

// 共通の束縛は決済(API_PAYMENTS_PLATFORM_MODULE)・メール・利用者の共通の束縛を使う
export const API_ULTRAS_PLATFORM_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  createUltrasPlatformModule('api');

// 決済の開始(API_PAYMENTS_MODULE)・利用者の確認(IDENTITY_PLATFORM_TYPES)・Ultrasの共通の束縛(API_ULTRAS_PLATFORM_MODULE)・
// 管理者の監査ログと名簿(ADMIN_PLATFORM_MODULE)は他のモジュールの束縛を使う
export const API_ULTRAS_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'ultras',
  bindings: new ContainerModule(({ bind }) => {
    bind<UltrasPlanReader>(API_ULTRAS_TYPES.UltrasPlanReader).to(
      DefaultUltrasPlanReader,
    );
    bind<UltrasCheckout>(API_ULTRAS_TYPES.UltrasCheckout).to(
      DefaultUltrasCheckout,
    );
    bind<PortalSessionLimits>(API_ULTRAS_TYPES.PortalSessionLimits).to(
      CounterPortalSessionLimits,
    );
    bind<PortalSessionStarter>(API_ULTRAS_TYPES.PortalSessionStarter).to(
      DefaultPortalSessionStarter,
    );
    // 機能フラグの読み取りと書き込みは同じD1の実装が担うため、1つのインスタンスを両方の識別子へ束縛する
    bind<PromotionSettingReader>(API_ULTRAS_TYPES.PromotionSettingReader)
      .to(D1PromotionSettingWriter)
      .inSingletonScope();
    bind<PromotionSettingWriter>(
      API_ULTRAS_TYPES.PromotionSettingWriter,
    ).toService(API_ULTRAS_TYPES.PromotionSettingReader);
    bind<PromotionSettingService>(API_ULTRAS_TYPES.PromotionSettingService).to(
      DefaultPromotionSettingService,
    );
  }),
};
