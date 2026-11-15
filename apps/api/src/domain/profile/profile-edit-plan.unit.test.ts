import { describe, expect, test } from 'bun:test';

import { planProfileEdit } from './profile-edit-plan.ts';

const planHandle = (current: string, next: string) =>
  planProfileEdit(
    { handle: current, avatarFileId: null },
    { handle: next, avatarFileId: null },
  ).handle;

const planAvatar = (current: string | null, next: string | null) =>
  planProfileEdit(
    { handle: 'alice', avatarFileId: current },
    { handle: 'alice', avatarFileId: next },
  ).avatar;

describe('planProfileEdit のハンドルの変更の種類', () => {
  test('完全に同じ文字列ならnoneになる', () => {
    expect(planHandle('alice', 'alice')).toEqual({ kind: 'none' });
  });

  test('大文字小文字だけが違う文字列ならcase-onlyになり新しい綴りを持つ', () => {
    expect(planHandle('alice', 'Alice')).toEqual({
      kind: 'case-only',
      next: 'Alice',
    });
  });

  test('大文字から小文字への変更もcase-onlyになる', () => {
    expect(planHandle('ALICE-01', 'alice-01')).toEqual({
      kind: 'case-only',
      next: 'alice-01',
    });
  });

  test('別の文字列への変更はchangedになり変更前のハンドルをpreviousに持つ', () => {
    expect(planHandle('alice', 'bob')).toEqual({
      kind: 'changed',
      next: 'bob',
      previous: 'alice',
    });
  });

  test('previousは現在のハンドルの綴りのまま保たれる', () => {
    expect(planHandle('Alice_1', 'alice_2')).toEqual({
      kind: 'changed',
      next: 'alice_2',
      previous: 'Alice_1',
    });
  });

  test('自分の旧ハンドルへ戻す変更もchangedになり直前のハンドルがpreviousになる', () => {
    expect(planHandle('alice-new', 'alice')).toEqual({
      kind: 'changed',
      next: 'alice',
      previous: 'alice-new',
    });
  });

  test('綴りが1文字でも異なる文字列はcase-onlyと見なさない', () => {
    expect(planHandle('abc', 'abd').kind).toBe('changed');
  });
});

describe('planProfileEdit の画像の決定', () => {
  test('同じ画像のIDならkeepになる', () => {
    expect(planAvatar('file-a', 'file-a')).toEqual({ kind: 'keep' });
  });

  test('画像が無いまま無しならkeepになる', () => {
    expect(planAvatar(null, null)).toEqual({ kind: 'keep' });
  });

  test('画像が無い状態から新しいIDを渡すとreplacedがnullのsetになる', () => {
    expect(planAvatar(null, 'file-b')).toEqual({
      kind: 'set',
      fileId: 'file-b',
      replaced: null,
    });
  });

  test('以前の画像があり別のIDを渡すと以前のIDをreplacedに持つsetになる', () => {
    expect(planAvatar('file-a', 'file-b')).toEqual({
      kind: 'set',
      fileId: 'file-b',
      replaced: 'file-a',
    });
  });

  test('以前の画像がありnullを渡すと以前のIDをremovedに持つremoveになる', () => {
    expect(planAvatar('file-a', null)).toEqual({
      kind: 'remove',
      removed: 'file-a',
    });
  });

  test('ハンドルの決定と画像の決定は互いに独立している', () => {
    const plan = planProfileEdit(
      { handle: 'alice', avatarFileId: 'file-a' },
      { handle: 'bob', avatarFileId: 'file-a' },
    );
    expect(plan).toEqual({
      handle: { kind: 'changed', next: 'bob', previous: 'alice' },
      avatar: { kind: 'keep' },
    });
  });
});
