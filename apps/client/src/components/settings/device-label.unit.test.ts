import { describe, expect, test } from 'bun:test';

import { deviceLabelOf } from './device-label.ts';

describe('deviceLabelOf', () => {
  test.each([
    ['Chrome', 'macOS', 'Chrome(macOS)'],
    ['Firefox', null, 'Firefox'],
    [null, 'Android', 'Android'],
    [null, null, '不明な端末'],
    ['', ' ', '不明な端末'],
  ])(
    'ブラウザ名%sとOS名%sは「%s」と表示する',
    (browserName, osName, expected) => {
      expect(deviceLabelOf({ browserName, osName })).toBe(expected);
    },
  );
});
