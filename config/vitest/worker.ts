import {
  createTestKindPreset,
  type TestKindPreset,
} from './test-kind-preset.ts';

// workerdではV8のカバレッジ計測を使えないため、Istanbulで計測する
export const workerTestPreset: TestKindPreset = createTestKindPreset(
  'worker',
  'istanbul',
);
