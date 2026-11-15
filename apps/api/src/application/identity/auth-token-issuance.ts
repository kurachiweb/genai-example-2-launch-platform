import {
  AUTH_TOKEN_HASH_PURPOSES,
  AUTH_TOKEN_TTL_SECONDS,
  type AuthTokenPurpose,
} from '../../domain/identity/auth-token-purpose.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { NewAuthToken } from './ports.ts';

export interface PreparedAuthToken {
  readonly token: NewAuthToken;
  // メールのリンクにだけ使い、保存しない
  readonly plain: string;
}

const MILLISECONDS_PER_SECOND = 1000;

export async function prepareAuthToken(
  secrets: SecretIssuer,
  userId: string,
  purpose: AuthTokenPurpose,
  now: Date,
): Promise<PreparedAuthToken> {
  const secret = await secrets.issue(AUTH_TOKEN_HASH_PURPOSES[purpose]);
  return {
    plain: secret.plain,
    token: {
      userId,
      purpose,
      tokenHash: secret.hash,
      expiresAt: new Date(
        now.getTime() +
          AUTH_TOKEN_TTL_SECONDS[purpose] * MILLISECONDS_PER_SECOND,
      ),
    },
  };
}
