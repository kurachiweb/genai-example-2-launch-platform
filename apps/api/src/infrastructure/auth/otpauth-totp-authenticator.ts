import { injectable } from 'inversify';
import { Secret, TOTP } from 'otpauth';

import type {
  TotpAuthenticator,
  TotpVerification,
} from '../../application/auth/ports.ts';

export class TotpSecretFormatError extends Error {
  override readonly name = 'TotpSecretFormatError';
}

const SECRET_BYTE_LENGTH = 20;

const ALGORITHM = 'SHA1';

const DIGITS = 6;

const PERIOD_SECONDS = 30;

const VERIFY_WINDOW = 1;

const CODE_PATTERN = /^[0-9]{6}$/;

// 先頭の`@`(ハンドルの表記)より後に`@`があればメールアドレスを含み得るため、認証アプリに表示されるラベルから締め出す
const EMBEDDED_AT_PATTERN = /.@/u;

function parseSecret(secret: string): Secret {
  let parsed: Secret;
  try {
    parsed = Secret.fromBase32(secret);
  } catch {
    // otpauthの例外のメッセージは秘密鍵の文字を含むため、原因として引き継がない
    throw new TotpSecretFormatError('TOTPの秘密鍵の形式が正しくありません。');
  }
  if (parsed.bytes.length === 0) {
    throw new TotpSecretFormatError('TOTPの秘密鍵の形式が正しくありません。');
  }
  return parsed;
}

function createTotp(
  secret: Secret,
  label?: { readonly issuer: string; readonly accountLabel: string },
): TOTP {
  return new TOTP({
    ...(label === undefined
      ? {}
      : { issuer: label.issuer, label: label.accountLabel }),
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret,
  });
}

@injectable()
export class OtpauthTotpAuthenticator implements TotpAuthenticator {
  generateSecret(): string {
    return new Secret({ size: SECRET_BYTE_LENGTH }).base32;
  }

  buildUri(secret: string, issuer: string, accountLabel: string): string {
    if (EMBEDDED_AT_PATTERN.test(accountLabel)) {
      throw new RangeError(
        'TOTPのラベルにはメールアドレスではなくハンドルを使ってください。',
      );
    }
    return createTotp(parseSecret(secret), { issuer, accountLabel }).toString();
  }

  verify(secret: string, code: string, now: Date): TotpVerification {
    const totp = createTotp(parseSecret(secret));
    if (!CODE_PATTERN.test(code)) {
      return { ok: false };
    }
    const timestamp = now.getTime();
    const delta = totp.validate({
      token: code,
      timestamp,
      window: VERIFY_WINDOW,
    });
    if (delta === null) {
      return { ok: false };
    }
    // 使用済みのコードの再利用を呼び出し元が検出できるよう、一致した時間窓の通し番号を返す
    return {
      ok: true,
      step: TOTP.counter({ period: PERIOD_SECONDS, timestamp }) + delta,
    };
  }
}
