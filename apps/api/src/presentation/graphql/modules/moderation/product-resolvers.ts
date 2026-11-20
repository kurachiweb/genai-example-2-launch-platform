import type { Resolvers } from '../../generated/resolvers-types.ts';

// プロダクトの一覧・詳細・カテゴリの選択肢・評価の一覧・非公開化・復元。各リゾルバはadminOnlyで包み、入力の検証より前に管理者側以外の呼び出しを拒否する
export const productResolvers = {
  Query: {},
  Mutation: {},
} satisfies Resolvers;
