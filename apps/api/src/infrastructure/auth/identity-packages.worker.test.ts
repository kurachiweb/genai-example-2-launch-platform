import Bowser from 'bowser';
import { Secret, TOTP, URI } from 'otpauth';
import { describe, expect, test } from 'vitest';

// RFC 6238の付録Bの試験用の秘密鍵
const RFC6238_SECRET = Secret.fromLatin1('12345678901234567890');

const CHROME_ON_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SAFARI_ON_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function rfc6238Totp(): TOTP {
  return new TOTP({
    issuer: 'Example',
    label: 'user@mail.example',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: RFC6238_SECRET,
  });
}

describe('認証が使うパッケージ(workerd)', () => {
  test('otpauthがTOTPのotpauth://のURIを生成し、同じ設定に読み戻せる', () => {
    const uri = rfc6238Totp().toString();

    expect(uri).toBe(
      `otpauth://totp/Example:user%40mail.example?issuer=Example&secret=${RFC6238_SECRET.base32}&algorithm=SHA1&digits=6&period=30`,
    );
    expect(URI.parse(uri)).toMatchObject({
      issuer: 'Example',
      label: 'user@mail.example',
      digits: 6,
      period: 30,
    });
  });

  test('otpauthがRFC 6238の試験値と一致するコードを生成する', () => {
    expect(rfc6238Totp().generate({ timestamp: 59_000 })).toBe('287082');
    expect(rfc6238Totp().generate({ timestamp: 1_111_111_109_000 })).toBe(
      '081804',
    );
  });

  test('otpauthが前後1つの時間窓のコードを差分付きで受け入れ、範囲外のコードを拒否する', () => {
    const totp = rfc6238Totp();
    const timestamp = 1_111_111_109_000;
    const previousWindowToken = totp.generate({
      timestamp: timestamp - 30_000,
    });
    const farToken = totp.generate({ timestamp: timestamp - 90_000 });

    expect(totp.validate({ token: '081804', timestamp, window: 1 })).toBe(0);
    expect(
      totp.validate({ token: previousWindowToken, timestamp, window: 1 }),
    ).toBe(-1);
    expect(totp.validate({ token: farToken, timestamp, window: 1 })).toBeNull();
  });

  test('otpauthが乱数から20バイトの秘密鍵を生成する', () => {
    expect(new Secret({ size: 20 }).bytes.byteLength).toBe(20);
  });

  test('bowserがUser-Agentからブラウザ名とOS名を得る', () => {
    const chrome = Bowser.getParser(CHROME_ON_WINDOWS);
    const safari = Bowser.getParser(SAFARI_ON_IPHONE);

    expect([chrome.getBrowserName(), chrome.getOSName()]).toEqual([
      'Chrome',
      'Windows',
    ]);
    expect([safari.getBrowserName(), safari.getOSName()]).toEqual([
      'Safari',
      'iOS',
    ]);
  });

  test('bowserが解釈できないUser-Agentに空の名前を返す', () => {
    const parser = Bowser.getParser('unknown-agent');

    expect([parser.getBrowserName(), parser.getOSName()]).toEqual(['', '']);
  });
});
