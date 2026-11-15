import type { ModerationOutcome } from './ports.ts';

export interface StubModerationImageSize {
  readonly width: number;
  readonly height: number;
}

const EXPLICIT_SIDE = 99;
const TRANSIENT_SIDE = 98;
const REJECTED_SIDE = 97;
const EXPLICIT_CONFIDENCE = 99;

const isSquareOf = (size: StubModerationImageSize, side: number): boolean =>
  size.width === side && size.height === side;

// ローカル・CIでは外部へ送らず、判定用画像の寸法だけで結果を決めて各経路を再現できるようにする
export function decideStubModeration(
  size: StubModerationImageSize,
): ModerationOutcome {
  if (isSquareOf(size, EXPLICIT_SIDE)) {
    return {
      kind: 'labels',
      labels: [
        {
          name: 'Explicit',
          parentName: '',
          confidence: EXPLICIT_CONFIDENCE,
          taxonomyLevel: 1,
        },
      ],
    };
  }
  if (isSquareOf(size, TRANSIENT_SIDE)) {
    return { kind: 'transient', reason: 'throttled' };
  }
  if (isSquareOf(size, REJECTED_SIDE)) {
    return { kind: 'rejected', reason: 'invalid-image' };
  }
  return { kind: 'labels', labels: [] };
}
