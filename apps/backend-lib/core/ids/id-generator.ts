import { monotonicFactory } from 'ulid';

import type { Clock } from '../time/clock.ts';

export interface IdGenerator {
  generate(): string;
}

export function createUlidGenerator(clock: Clock): IdGenerator {
  const nextUlid = monotonicFactory();
  return {
    generate: () => nextUlid(clock.now().getTime()),
  };
}
