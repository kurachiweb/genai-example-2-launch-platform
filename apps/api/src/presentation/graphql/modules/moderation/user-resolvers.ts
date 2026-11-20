import type { Resolvers } from '../../generated/resolvers-types.ts';

// 利用者の一覧・停止・停止解除・代理の退会。各リゾルバはadminOnlyで包み、入力の検証より前に管理者側以外の呼び出しを拒否する
export const userResolvers = {
  Query: {},
  Mutation: {},
} satisfies Resolvers;
