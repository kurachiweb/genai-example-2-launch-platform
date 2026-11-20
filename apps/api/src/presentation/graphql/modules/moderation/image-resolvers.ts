import type { Resolvers } from '../../generated/resolvers-types.ts';

// 隔離画像の一覧と画像の措置。各リゾルバはadminOnlyで包み、入力の検証より前に管理者側以外の呼び出しを拒否する
export const imageResolvers = {
  Query: {},
  Mutation: {},
} satisfies Resolvers;
