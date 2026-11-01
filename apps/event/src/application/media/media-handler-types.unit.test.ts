import { describe, expect, test } from 'bun:test';

import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import { EVENT_MEDIA_HANDLER_TYPES } from './media-handler-types.ts';
import { EVENT_MEDIA_TYPES } from './ports.ts';

const EXPECTED_NAMES = [
  'ModerateImageHandler',
  'RelocateFilesHandler',
  'PurgeImageCacheHandler',
] as const;

describe('EVENT_MEDIA_HANDLER_TYPES', () => {
  test('メディアの3種のメッセージの処理の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_MEDIA_HANDLER_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のmedia.<名前>である',
    (name) => {
      expect<symbol>(EVENT_MEDIA_HANDLER_TYPES[name]).toBe(
        Symbol.for(`media.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なり、メディアのポートの識別子と重ならない', () => {
    const others = new Set<symbol>([
      ...Object.values(MEDIA_TYPES),
      ...Object.values(EVENT_MEDIA_TYPES),
    ]);
    const handlers = Object.values(EVENT_MEDIA_HANDLER_TYPES);

    expect(new Set(handlers).size).toBe(EXPECTED_NAMES.length);
    expect(handlers.filter((identifier) => others.has(identifier))).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_MEDIA_HANDLER_TYPES)).toBe(true);
  });
});
