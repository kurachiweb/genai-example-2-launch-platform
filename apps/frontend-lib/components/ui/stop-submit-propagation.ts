import type { SubmitEventHandler } from 'react';

export function stopSubmitPropagation<T extends Element>(
  onSubmit?: SubmitEventHandler<T>,
): SubmitEventHandler<T> {
  return (event) => {
    onSubmit?.(event);
    event.stopPropagation();
  };
}
