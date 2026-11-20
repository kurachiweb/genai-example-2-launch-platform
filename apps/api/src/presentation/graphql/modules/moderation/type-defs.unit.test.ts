import { describe, expect, test } from 'bun:test';
import { Kind, parse } from 'graphql';

import { MODERATION_TYPE_DEFS } from './type-defs.ts';

function rootFieldsOf(typeName: 'Query' | 'Mutation'): string[] {
  return parse(MODERATION_TYPE_DEFS).definitions.flatMap((definition) =>
    definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
    definition.name.value === typeName
      ? (definition.fields ?? []).map((field) => field.name.value)
      : [],
  );
}

describe('MODERATION_TYPE_DEFS', () => {
  test('措置の群の照会は利用者・プロダクト・コメント・評価・隔離画像の一覧と詳細とカテゴリの選択肢で、統計の照会を持たない', () => {
    expect(rootFieldsOf('Query').toSorted()).toEqual([
      'adminComments',
      'adminModerationCategoryOptions',
      'adminProduct',
      'adminProductRatings',
      'adminProducts',
      'adminQuarantinedImages',
      'adminRatings',
      'adminUsers',
    ]);
  });

  test('措置の操作は13種である', () => {
    expect(rootFieldsOf('Mutation').toSorted()).toEqual([
      'approveQuarantinedImage',
      'deleteQuarantinedImage',
      'hideComment',
      'hideProduct',
      'invalidateRating',
      'quarantineImage',
      'releaseQuarantinedImage',
      'revalidateRating',
      'suspendUser',
      'unhideComment',
      'unhideProduct',
      'unsuspendUser',
      'withdrawUserByAdministrator',
    ]);
  });

  test('ルート型をextendで書かない', () => {
    expect(
      parse(MODERATION_TYPE_DEFS).definitions.filter(
        ({ kind }) => kind === Kind.OBJECT_TYPE_EXTENSION,
      ),
    ).toEqual([]);
  });
});
