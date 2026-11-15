import { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import { EMAIL_TYPES } from '../../../../lib/core/email/identifiers.ts';
import type { SenderInfoProvider } from '../../../../lib/core/email/ports.ts';
import { UnsetSenderInfoProvider } from './unset-sender-info-provider.ts';

describe('未設定の送信者情報の既定実装', () => {
  test('送信者情報を未設定として返す', async () => {
    const provider = new UnsetSenderInfoProvider();

    const senderInfo = await provider.get();

    expect(senderInfo).toBeUndefined();
  });

  test('送信者情報の取得口の識別子へ束縛して解決しても、未設定を返す', async () => {
    const container = new Container();
    container
      .bind<SenderInfoProvider>(EMAIL_TYPES.SenderInfoProvider)
      .to(UnsetSenderInfoProvider);

    const provider = container.get<SenderInfoProvider>(
      EMAIL_TYPES.SenderInfoProvider,
    );

    await expect(provider.get()).resolves.toBeUndefined();
  });
});
