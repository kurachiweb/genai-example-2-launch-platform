import type { EmailProvider } from '../../../application/email/ports.ts';
import { toMatchingKey } from '../../../../lib/core/email/email-address.ts';

export function createRecipientAllowlistProvider(
  inner: EmailProvider,
  allowedKeys: ReadonlySet<string>,
): EmailProvider {
  return {
    send(email) {
      if (!allowedKeys.has(toMatchingKey(email.to))) {
        return Promise.resolve({ kind: 'recipient-not-allowed' });
      }
      return inner.send(email);
    },
  };
}
