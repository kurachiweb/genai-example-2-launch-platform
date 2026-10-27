import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';

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
