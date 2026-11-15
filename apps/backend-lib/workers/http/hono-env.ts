import type { Container } from 'inversify';

import type { PlatformEnv } from '../env/platform-env.ts';

export interface PlatformHonoEnv<E extends PlatformEnv> {
  readonly Bindings: E;
  readonly Variables: {
    readonly correlationId: string;
    readonly clientIp: string | undefined;
    readonly container: Container;
  };
}
