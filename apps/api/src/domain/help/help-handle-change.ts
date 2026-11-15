import { isSameHandle } from '../../../common-lib/handles/handle-rules.ts';

export type HelpHandleChange =
  | { readonly kind: 'none' }
  | { readonly kind: 'case-only'; readonly next: string }
  | {
      readonly kind: 'changed';
      readonly next: string;
      readonly previous: string;
    };

export const planHelpHandleChange = (
  current: string,
  next: string,
): HelpHandleChange => {
  if (current === next) {
    return { kind: 'none' };
  }
  if (isSameHandle(current, next)) {
    return { kind: 'case-only', next };
  }
  return { kind: 'changed', next, previous: current };
};
