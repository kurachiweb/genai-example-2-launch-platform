import { describe, expect, test } from 'vitest';

import type { DeviceDescriber } from '../../application/identity/ports.ts';
import { BowserDeviceDescriber } from './bowser-device-describer.ts';

const CHROME_ON_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SAFARI_ON_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const FIREFOX_ON_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';

function createDescriber(): DeviceDescriber {
  return new BowserDeviceDescriber();
}

describe('BowserDeviceDescriber', () => {
  test.each([
    {
      label: 'WindowsのChrome',
      userAgent: CHROME_ON_WINDOWS,
      browserName: 'Chrome',
      osName: 'Windows',
    },
    {
      label: 'iPhoneのSafari',
      userAgent: SAFARI_ON_IPHONE,
      browserName: 'Safari',
      osName: 'iOS',
    },
    {
      label: 'LinuxのFirefox',
      userAgent: FIREFOX_ON_LINUX,
      browserName: 'Firefox',
      osName: 'Linux',
    },
  ])(
    '$labelのUser-Agentからブラウザ名とOS名を得る',
    ({ userAgent, browserName, osName }) => {
      expect(createDescriber().describe(userAgent)).toStrictEqual({
        browserName,
        osName,
      });
    },
  );

  test.each([
    { label: '無い', userAgent: null },
    { label: '空の', userAgent: '' },
    { label: '空白だけの', userAgent: '   ' },
    { label: '解析できない', userAgent: 'unknown-agent' },
    { label: 'ブラウザでない', userAgent: 'curl/8.5.0' },
  ])('$labelUser-Agentでは、ブラウザ名とOS名が無い', ({ userAgent }) => {
    expect(createDescriber().describe(userAgent)).toStrictEqual({
      browserName: null,
      osName: null,
    });
  });
});
