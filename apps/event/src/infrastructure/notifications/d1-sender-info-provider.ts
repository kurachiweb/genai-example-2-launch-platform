import { inject, injectable } from 'inversify';

import type {
  SenderInfo,
  SenderInfoProvider,
} from '../../../lib/core/email/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type { SenderInfoStore } from '../../../lib/core/notifications/ports.ts';

// 保存の直後のメールから新しい値を載せるため、isolateの中で値を持ち越さず毎回読む
@injectable()
export class D1SenderInfoProvider implements SenderInfoProvider {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.SenderInfoStore)
    private readonly store: SenderInfoStore,
  ) {}

  async get(): Promise<SenderInfo | undefined> {
    const record = await this.store.get();
    return record?.info;
  }
}
