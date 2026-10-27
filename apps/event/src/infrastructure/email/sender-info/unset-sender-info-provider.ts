import { injectable } from 'inversify';

import type {
  SenderInfo,
  SenderInfoProvider,
} from '../../../../lib/core/email/ports.ts';

@injectable()
export class UnsetSenderInfoProvider implements SenderInfoProvider {
  get(): Promise<SenderInfo | undefined> {
    return Promise.resolve(undefined);
  }
}
