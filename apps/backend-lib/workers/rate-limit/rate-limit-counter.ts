import { DurableObject } from 'cloudflare:workers';

import {
  applyHit,
  type CounterDecision,
  type CounterRule,
  type WindowState,
} from '../../core/rate-limit/fixed-window.ts';

const WINDOW_STATE_KEY = 'window';
const MILLISECONDS_PER_SECOND = 1000;

function windowEndsAt(state: WindowState): number {
  return state.windowStartedAt + state.windowSeconds * MILLISECONDS_PER_SECOND;
}

export class RateLimitCounter extends DurableObject {
  async hit(rule: CounterRule): Promise<CounterDecision> {
    const { storage } = this.ctx;
    // 読み出しから保存までを同期のKVで行い、同じオブジェクトへの並行した要求の間に割り込まれないようにする
    const outcome = applyHit(
      storage.kv.get<WindowState>(WINDOW_STATE_KEY),
      Date.now(),
      rule,
    );
    if (outcome.next !== undefined) {
      storage.kv.put(WINDOW_STATE_KEY, outcome.next);
    }
    if (outcome.scheduleAlarmAt !== undefined) {
      await storage.setAlarm(outcome.scheduleAlarmAt);
    }
    return outcome.decision;
  }

  async reset(): Promise<void> {
    await this.clear();
  }

  override async alarm(): Promise<void> {
    const { storage } = this.ctx;
    const state = storage.kv.get<WindowState>(WINDOW_STATE_KEY);
    // Alarmは重複して実行され得るため、続いている期間の記録は消さない
    if (state !== undefined && Date.now() < windowEndsAt(state)) {
      if ((await storage.getAlarm()) === null) {
        await storage.setAlarm(windowEndsAt(state));
      }
      return;
    }
    await this.clear();
  }

  private async clear(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
