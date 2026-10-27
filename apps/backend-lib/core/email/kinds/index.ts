import type { AnyEmailKind } from '../email-kind.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from './email-delivery-smoke.ts';

export const EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  EMAIL_DELIVERY_SMOKE_KIND,
]);
