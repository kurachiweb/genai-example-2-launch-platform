import { describe, expect, mock, test } from 'bun:test';
import type { SubmitEvent } from 'react';

import { stopSubmitPropagation } from './stop-submit-propagation.ts';

function createEvent() {
  const stopPropagation = mock<() => void>();
  const event = { stopPropagation } as unknown as SubmitEvent<HTMLDivElement>;
  return { event, stopPropagation };
}

describe('stopSubmitPropagation', () => {
  test('呼び出し側のハンドラーを渡さなくても、伝播を止める', () => {
    const { event, stopPropagation } = createEvent();

    stopSubmitPropagation<HTMLDivElement>()(event);

    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  test('呼び出し側のハンドラーに同じイベントを渡してから、伝播を止める', () => {
    const { event, stopPropagation } = createEvent();
    const order: string[] = [];
    const handler = mock((received: SubmitEvent<HTMLDivElement>) => {
      expect(received).toBe(event);
      order.push('handler');
    });
    stopPropagation.mockImplementation(() => {
      order.push('stop');
    });

    stopSubmitPropagation(handler)(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['handler', 'stop']);
  });
});
