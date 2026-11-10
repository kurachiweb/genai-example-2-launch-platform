import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import {
  MATCH_KICKOFF_JOB_DEFINITION,
  MATCH_SETTLEMENT_JOB_DEFINITION,
  QUALIFIER_PAIRING_JOB_DEFINITION,
} from '../../src/application/match/match-jobs.ts';
import { MATCH_TYPES } from '../../src/application/match/match-types.ts';
import { SCHEDULED_JOBS } from '../../src/composition/scheduled-jobs.ts';

const SETTLEMENT_CRON = toUtcCronExpression({ hour: 23, minute: 40 });
const PAIRING_CRON = toUtcCronExpression({ hour: 23, minute: 45 });
const KICKOFF_CRON = toUtcCronExpression({ hour: 0, minute: 0 });

const DAILY_JOBS = [
  MATCH_SETTLEMENT_JOB_DEFINITION,
  QUALIFIER_PAIRING_JOB_DEFINITION,
  MATCH_KICKOFF_JOB_DEFINITION,
] as const;

describe('マッチの日次のジョブの定期実行の一覧への登録', () => {
  test('確定・ペアリング・開始の3つの定義を、業務時刻23:40・23:45・0:00とorder 1100で定める', () => {
    expect(DAILY_JOBS).toEqual([
      {
        name: 'match-engine.match-settlement',
        at: { hour: 23, minute: 40 },
        order: 1100,
        handler: MATCH_TYPES.MatchSettlementJob,
      },
      {
        name: 'match-engine.qualifier-pairing',
        at: { hour: 23, minute: 45 },
        order: 1100,
        handler: MATCH_TYPES.QualifierPairingJob,
      },
      {
        name: 'match-engine.match-kickoff',
        at: { hour: 0, minute: 0 },
        order: 1100,
        handler: MATCH_TYPES.MatchKickoffJob,
      },
    ]);
  });

  test('3つの定義を、そのまま定期実行の一覧に載せる', () => {
    for (const definition of DAILY_JOBS) {
      expect(SCHEDULED_JOBS).toContain(definition);
    }
  });

  test('定期実行の一覧はジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() => createCronRegistry(SCHEDULED_JOBS)).not.toThrow();
  });

  test('23:40の起動(40 7 * * *)では、決済の突合(order 10)の後に確定のジョブが動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(SETTLEMENT_CRON)
      .map(({ name, order }) => ({ name, order }));

    expect(SETTLEMENT_CRON).toBe('40 7 * * *');
    expect(jobs).toEqual([
      { name: 'payments.checkout-reconciliation', order: 10 },
      { name: 'match-engine.match-settlement', order: 1100 },
    ]);
  });

  test('23:45の起動(45 7 * * *)と0:00の起動(0 8 * * *)では、それぞれペアリングと開始のジョブが動く', () => {
    const registry = createCronRegistry(SCHEDULED_JOBS);

    expect(PAIRING_CRON).toBe('45 7 * * *');
    expect(KICKOFF_CRON).toBe('0 8 * * *');
    expect(registry.jobsFor(PAIRING_CRON).map(({ name }) => name)).toEqual([
      'match-engine.qualifier-pairing',
    ]);
    expect(registry.jobsFor(KICKOFF_CRON).map(({ name }) => name)).toEqual([
      'match-engine.match-kickoff',
    ]);
  });

  test('本機能のジョブの順は、割り当てられた1100番台の帯に収まる', () => {
    for (const { order } of DAILY_JOBS) {
      expect(order).toBeGreaterThanOrEqual(1100);
      expect(order).toBeLessThan(1200);
    }
  });
});
