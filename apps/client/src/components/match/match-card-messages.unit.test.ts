import { describe, expect, test } from 'bun:test';

import {
  cancelUpvoteLabel,
  matchCardLabel,
  upvoteLabel,
} from './match-card-messages.ts';

describe('対戦カードの文言', () => {
  test('対戦カードの名前は2つのプロダクトの名称を「vs」でつなぐ', () => {
    expect(matchCardLabel('Pitch Notes', 'Tactics Board')).toBe(
      'Pitch Notes vs Tactics Board',
    );
  });

  test('Upvoteボタンの名前はUpvote前が「<名称>にUpvote」、Upvote済みが「<名称>へのUpvoteを取り消す」である', () => {
    expect(upvoteLabel('Pitch Notes')).toBe('Pitch NotesにUpvote');
    expect(cancelUpvoteLabel('Pitch Notes')).toBe(
      'Pitch NotesへのUpvoteを取り消す',
    );
  });
});
