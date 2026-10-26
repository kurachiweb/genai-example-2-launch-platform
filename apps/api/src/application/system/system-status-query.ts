import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

export interface DatabaseProbe {
  // 到達できない場合も例外を投げずに偽を返す
  isReachable(): Promise<boolean>;
}

export interface SystemStatus {
  // エポックミリ秒
  readonly serverTime: number;
  readonly databaseReachable: boolean;
}

export interface SystemStatusQuery {
  execute(): Promise<SystemStatus>;
}

const SystemStatusQuery: unique symbol = Symbol.for('system.SystemStatusQuery');
const DatabaseProbe: unique symbol = Symbol.for('system.DatabaseProbe');

export const SYSTEM_TYPES = Object.freeze({
  SystemStatusQuery,
  DatabaseProbe,
});

@injectable()
export class DefaultSystemStatusQuery implements SystemStatusQuery {
  constructor(
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(SYSTEM_TYPES.DatabaseProbe) private readonly probe: DatabaseProbe,
  ) {}

  async execute(): Promise<SystemStatus> {
    const serverTime = this.clock.now().getTime();
    const databaseReachable = await this.probe.isReachable();
    return { serverTime, databaseReachable };
  }
}
