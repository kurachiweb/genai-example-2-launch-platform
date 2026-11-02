import { DurableObject } from 'cloudflare:workers';

import {
  alarmOutcome,
  applyFailure,
  currentStatus,
  type LoginThrottleState,
  type ThrottleStatus,
} from '../../domain/auth/login-throttle-state.ts';

const STATE_KEY = 'state';

export class LoginAttemptThrottle extends DurableObject {
  status(now: number): Promise<ThrottleStatus> {
    return Promise.resolve(currentStatus(this.readState(), now));
  }

  async recordFailure(now: number): Promise<ThrottleStatus> {
    const { storage } = this.ctx;
    // 読み出しから保存までを同期のKVで行い、同じ単位への並行した失敗の間に割り込まれないようにする
    const state = this.readState();
    const { next, status, alarmAt } = applyFailure(state, now);
    // ロック中の失敗は数えず、記録とロックの終了時刻のアラームはそのまま残っている
    if (next === state) {
      return status;
    }
    storage.kv.put(STATE_KEY, next);
    await storage.setAlarm(alarmAt);
    return status;
  }

  async reset(): Promise<void> {
    await this.clear();
  }

  override async alarm(): Promise<void> {
    const state = this.readState();
    if (state === undefined) {
      await this.clear();
      return;
    }
    const outcome = alarmOutcome(state, Date.now());
    switch (outcome.kind) {
      case 'clear':
        await this.clear();
        return;
      case 'unlock':
        this.ctx.storage.kv.put(STATE_KEY, outcome.next);
        await this.ctx.storage.setAlarm(outcome.alarmAt);
        return;
      case 'reschedule':
        await this.ctx.storage.setAlarm(outcome.alarmAt);
        return;
    }
  }

  private readState(): LoginThrottleState | undefined {
    return this.ctx.storage.kv.get<LoginThrottleState>(STATE_KEY);
  }

  private async clear(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
