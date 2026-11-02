import { expect } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

export type FocusMovingKey =
  'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

// Radixのロービングフォーカスは押下の処理の後でフォーカスを移し、ラジオは押している間に移ったフォーカスで項目を選ぶ。Playwrightは押下と解放を間を置かずに送るため、人の操作と同じくフォーカスが移るまで押したままにする
export async function pressKeyUntilFocusMoves(
  key: FocusMovingKey,
): Promise<void> {
  const focusedBefore = document.activeElement;
  await userEvent.keyboard(`{${key}>}`);
  await expect.poll(() => document.activeElement).not.toBe(focusedBefore);
  await userEvent.keyboard(`{/${key}}`);
}

const ESCAPE_KEY = {
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
} as const;

export interface HeldEscapeOptions {
  // 最初の押下の後、キーの繰り返しが始まるまでに待つこと
  readonly afterFirstPress: () => Promise<void>;
  readonly repeats: number;
}

// Playwrightのキー操作はキーの繰り返し(KeyboardEvent.repeat)を送らないため、押し続けたEscapeをブラウザへの入力として送る
export async function holdEscapeKey({
  afterFirstPress,
  repeats,
}: HeldEscapeOptions): Promise<void> {
  await cdp().send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...ESCAPE_KEY,
  });
  try {
    await afterFirstPress();
    for (let index = 0; index < repeats; index += 1) {
      await cdp().send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        ...ESCAPE_KEY,
        autoRepeat: true,
      });
    }
  } finally {
    await cdp().send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...ESCAPE_KEY,
    });
  }
}
