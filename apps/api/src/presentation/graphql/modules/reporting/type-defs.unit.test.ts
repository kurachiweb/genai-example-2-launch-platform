import { describe, expect, test } from 'bun:test';
import { Kind, parse } from 'graphql';

import { REPORTING_TYPE_DEFS } from './type-defs.ts';

function rootFieldsOf(typeName: 'Query' | 'Mutation'): string[] {
  return parse(REPORTING_TYPE_DEFS).definitions.flatMap((definition) =>
    definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
    definition.name.value === typeName
      ? (definition.fields ?? []).map((field) => field.name.value)
      : [],
  );
}

describe('REPORTING_TYPE_DEFS', () => {
  test('照会は利用者側のカテゴリと、管理画面の案件の一覧・詳細・未対応の件数・プロダクトの件数・カテゴリである', () => {
    expect(rootFieldsOf('Query').toSorted()).toEqual([
      'adminProductReportSummary',
      'adminReportCase',
      'adminReportCases',
      'adminReportCategories',
      'adminUnhandledReportSummary',
      'reportCategories',
    ]);
  });

  test('変更は利用者側の通報と、案件の5つの操作とカテゴリの3つの操作である', () => {
    expect(rootFieldsOf('Mutation').toSorted()).toEqual([
      'changeReportCaseStatus',
      'createReportCategory',
      'deleteReportCategory',
      'rejectReportCase',
      'renameReportCategory',
      'resolveReportCaseWithMeasure',
      'resolveReportCaseWithoutMeasure',
      'sendInfringementInquiry',
      'submitReport',
    ]);
  });

  test('ルート型をextendで書かない', () => {
    expect(
      parse(REPORTING_TYPE_DEFS).definitions.filter(
        ({ kind }) => kind === Kind.OBJECT_TYPE_EXTENSION,
      ),
    ).toEqual([]);
  });
});
