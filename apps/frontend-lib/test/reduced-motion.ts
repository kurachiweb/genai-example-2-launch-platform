import { cdp } from 'vitest/browser';

export type ReducedMotionPreference = 'reduce' | 'no-preference';

export const REDUCED_MOTION_PREFERENCES: readonly ReducedMotionPreference[] = [
  'no-preference',
  'reduce',
];

export async function emulateReducedMotion(
  value: ReducedMotionPreference,
): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
}
