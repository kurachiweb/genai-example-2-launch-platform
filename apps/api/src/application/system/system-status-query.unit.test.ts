import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  type DatabaseProbe,
  DefaultSystemStatusQuery,
  SYSTEM_TYPES,
  type SystemStatusQuery,
} from './system-status-query.ts';

const FIXED_TIME = new Date('2030-01-15T12:34:56.789Z');

const fixedClock: Clock = { now: () => new Date(FIXED_TIME) };

function probeOf(reachable: boolean): DatabaseProbe {
  return { isReachable: () => Promise.resolve(reachable) };
}

function createContainer(probe: DatabaseProbe): Container {
  const container = new Container({ defaultScope: 'Transient' });
  container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(fixedClock);
  container
    .bind<DatabaseProbe>(SYSTEM_TYPES.DatabaseProbe)
    .toConstantValue(probe);
  container
    .bind<SystemStatusQuery>(SYSTEM_TYPES.SystemStatusQuery)
    .to(DefaultSystemStatusQuery);
  return container;
}

describe('DefaultSystemStatusQuery', () => {
  test.each([true, false])(
    'データベースの到達可否が%sなら、時計の時刻のエポックミリ秒とその到達可否を返す',
    async (reachable) => {
      const query = new DefaultSystemStatusQuery(
        fixedClock,
        probeOf(reachable),
      );

      const status = await query.execute();

      expect(status).toEqual({
        serverTime: FIXED_TIME.getTime(),
        databaseReachable: reachable,
      });
    },
  );

  test('識別子に束縛すると、コンテナが時計と到達確認を注入したユースケースを返す', async () => {
    const container = createContainer(probeOf(true));

    const query = container.get<SystemStatusQuery>(
      SYSTEM_TYPES.SystemStatusQuery,
    );

    expect(await query.execute()).toEqual({
      serverTime: FIXED_TIME.getTime(),
      databaseReachable: true,
    });
  });
});

describe('SYSTEM_TYPES', () => {
  test('ユースケースと到達確認のポートの識別子はグローバルなシンボルで、実行時に書き換えられない', () => {
    expect<symbol>(SYSTEM_TYPES.SystemStatusQuery).toBe(
      Symbol.for('system.SystemStatusQuery'),
    );
    expect<symbol>(SYSTEM_TYPES.DatabaseProbe).toBe(
      Symbol.for('system.DatabaseProbe'),
    );
    expect(Object.isFrozen(SYSTEM_TYPES)).toBe(true);
  });
});
