import { describe, expect, test } from 'bun:test';

import {
  describeFocusProblem,
  type FocusIndicatorStyle,
  hasVisibleFocusIndicator,
  isTransparentColor,
} from './keyboard-focus.ts';

const RING_OUTLINE: FocusIndicatorStyle = {
  description: 'button「保存」',
  focusVisible: true,
  outlineStyle: 'solid',
  outlineWidthPx: 2,
  outlineColor: 'rgb(37, 99, 235)',
  boxShadow: 'none',
};

describe('isTransparentColor', () => {
  test('transparentとアルファが0の色は透明と判定する', () => {
    expect(isTransparentColor('transparent')).toBe(true);
    expect(isTransparentColor('rgba(0, 0, 0, 0)')).toBe(true);
    expect(isTransparentColor('oklab(0.5 0.1 0.1 / 0)')).toBe(true);
  });

  test('アルファが0より大きい色と不透明な色は透明と判定しない', () => {
    expect(isTransparentColor('rgb(37, 99, 235)')).toBe(false);
    expect(isTransparentColor('oklab(0.5 0.1 0.1 / 0.5)')).toBe(false);
    expect(isTransparentColor('rgba(0, 0, 0, 0.2)')).toBe(false);
  });
});

describe('hasVisibleFocusIndicator', () => {
  test('2px以上の実線の輪郭があれば見えると判定する', () => {
    expect(hasVisibleFocusIndicator(RING_OUTLINE)).toBe(true);
  });

  test(':focus-visibleに一致しない要素は見えないと判定する', () => {
    expect(
      hasVisibleFocusIndicator({ ...RING_OUTLINE, focusVisible: false }),
    ).toBe(false);
  });

  test('輪郭が無い要素は見えないと判定する', () => {
    expect(
      hasVisibleFocusIndicator({ ...RING_OUTLINE, outlineStyle: 'none' }),
    ).toBe(false);
  });

  test('輪郭が2px未満の要素は見えないと判定する', () => {
    expect(
      hasVisibleFocusIndicator({ ...RING_OUTLINE, outlineWidthPx: 1 }),
    ).toBe(false);
  });

  test('輪郭の色が透明の要素は見えないと判定する', () => {
    expect(
      hasVisibleFocusIndicator({
        ...RING_OUTLINE,
        outlineColor: 'rgba(0, 0, 0, 0)',
      }),
    ).toBe(false);
  });

  test('輪郭が実線でない要素は見えないと判定する', () => {
    expect(
      hasVisibleFocusIndicator({ ...RING_OUTLINE, outlineStyle: 'dashed' }),
    ).toBe(false);
  });

  test('輪郭が無い要素は、広がりのあるリングの影があっても見えないと判定する', () => {
    expect(
      hasVisibleFocusIndicator({
        ...RING_OUTLINE,
        outlineStyle: 'none',
        boxShadow: 'rgba(37, 99, 235, 0.5) 0px 0px 0px 3px',
      }),
    ).toBe(false);
  });
});

describe('describeFocusProblem', () => {
  test('要素の説明と輪郭の計算値を含む', () => {
    const message = describeFocusProblem({
      ...RING_OUTLINE,
      outlineStyle: 'none',
      outlineWidthPx: 0,
    });

    expect(message).toContain('button「保存」');
    expect(message).toContain('outline: none 0px');
  });
});
