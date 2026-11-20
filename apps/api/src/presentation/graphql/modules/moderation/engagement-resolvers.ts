import type { Resolvers } from '../../generated/resolvers-types.ts';

// コメントと評価の一覧と措置。各リゾルバはadminOnlyで包み、入力の検証より前に管理者側以外の呼び出しを拒否する
export const engagementResolvers = {
  Query: {},
  Mutation: {},
} satisfies Resolvers;
