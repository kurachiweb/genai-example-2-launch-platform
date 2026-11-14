import type * as WhatwgNodeFetch from '@whatwg-node/fetch';

// 宣言ファイル内の型エラーはskipLibCheckで隠れてanyになるため、公開の型がanyでないことを型検査の対象のファイルで確かめる
type IsAny<T> = 0 extends 1 & T ? true : false;

type AnyMemberNames<T> = {
  [K in keyof T]: IsAny<T[K]> extends true ? K : never;
}[keyof T];

type ExpectNever<T extends never> = T;

type FetchModule = typeof WhatwgNodeFetch;

type InstanceMembers = {
  readonly [
    K in keyof FetchModule as FetchModule[K] extends abstract new (
      ...args: never[]
    ) => unknown
      ? K
      : never
  ]: FetchModule[K] extends abstract new (...args: never[]) => infer I
    ? I
    : never;
};

export type ModuleMembersAreTyped = ExpectNever<AnyMemberNames<FetchModule>>;

export type CreateFetchMembersAreTyped = ExpectNever<
  AnyMemberNames<ReturnType<FetchModule['createFetch']>>
>;

export type InstancesAreTyped = ExpectNever<AnyMemberNames<InstanceMembers>>;
