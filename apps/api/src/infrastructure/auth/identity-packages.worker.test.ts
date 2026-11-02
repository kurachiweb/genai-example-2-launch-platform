import Bowser from 'bowser';
import { describe, expect, test } from 'vitest';

const CHROME_ON_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SAFARI_ON_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('認証が使うパッケージ(workerd)', () => {
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
