import {
  ADMIN_AUTH_TOKEN_TTL_SECONDS,
  ADMIN_HASH_PURPOSES,
} from '../../domain/admin/admin-auth-token-purpose.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { NewAdminAuthToken } from './ports.ts';

export interface PreparedAdminAuthToken {
  readonly token: NewAdminAuthToken;
  // メールのリンクにだけ使い、保存しない
  readonly plain: string;
}

const MILLISECONDS_PER_SECOND = 1000;

export async function prepareAdminAuthToken(
  secrets: SecretIssuer,
  adminId: string,
  purpose: NewAdminAuthToken['purpose'],
  now: Date,
): Promise<PreparedAdminAuthToken> {
  const secret = await secrets.issue(ADMIN_HASH_PURPOSES.authToken(purpose));
  return {
    plain: secret.plain,
    token: {
      adminId,
      purpose,
      tokenHash: secret.hash,
      expiresAt: new Date(
        now.getTime() +
          ADMIN_AUTH_TOKEN_TTL_SECONDS[purpose] * MILLISECONDS_PER_SECOND,
      ),
    },
  };
}
