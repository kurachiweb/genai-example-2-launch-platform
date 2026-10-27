import type { EmailProvider } from '../../../application/email/ports.ts';
import { toMatchingKey } from '../../../../lib/core/email/email-address.ts';
import {
  createCloudflareEmailProvider,
  type SendEmailBindingLike,
} from './cloudflare-email-provider.ts';
import { createMailpitEmailProvider } from './mailpit-email-provider.ts';
import { createRecipientAllowlistProvider } from './recipient-allowlist-provider.ts';

export interface EventEmailEnv {
  readonly EMAIL_PROVIDER: 'mailpit' | 'cloudflare';
  readonly EMAIL_RECIPIENT_POLICY: 'any' | 'allowlist';
  readonly EMAIL_ALLOWED_RECIPIENTS?: string;
  readonly MAILPIT_API_URL?: string;
  readonly EMAIL?: SendEmailBindingLike;
}

// 設定の値は個人のアドレスを含み得るため、例外のメッセージにはキー名だけを載せる
function missingSetting(key: string): Error {
  return new Error(`メールの送信に必要な設定${key}がありません。`);
}

function parseAllowedKeys(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(',')
      .map(toMatchingKey)
      .filter((key) => key !== ''),
  );
}

function createBaseProvider(
  env: EventEmailEnv,
  fetcher: typeof fetch,
): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'mailpit':
      if (env.MAILPIT_API_URL === undefined) {
        throw missingSetting('MAILPIT_API_URL');
      }
      return createMailpitEmailProvider(env.MAILPIT_API_URL, fetcher);
    case 'cloudflare':
      if (env.EMAIL === undefined) {
        throw missingSetting('EMAIL');
      }
      return createCloudflareEmailProvider(env.EMAIL);
  }
}

export function createEmailProvider(
  env: EventEmailEnv,
  fetcher: typeof fetch,
): EmailProvider {
  const provider = createBaseProvider(env, fetcher);
  if (env.EMAIL_RECIPIENT_POLICY === 'any') {
    return provider;
  }
  if (env.EMAIL_ALLOWED_RECIPIENTS === undefined) {
    throw missingSetting('EMAIL_ALLOWED_RECIPIENTS');
  }
  return createRecipientAllowlistProvider(
    provider,
    parseAllowedKeys(env.EMAIL_ALLOWED_RECIPIENTS),
  );
}
