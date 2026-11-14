// 生成した型はmainModuleの型としてサーバーのエントリを読み込み、エントリが拡張するモジュールはプログラムに含まれないと拡張の対象として解決されないため、型だけを読み込んでおく
import type {} from '@tanstack/react-start';

import type {
  FrontendEnvInput,
  RateLimiter,
  ServiceFetcher,
} from '../../lib/server/env/frontend-env.ts';

// 実行時の型を含めずに生成した型は、バインディングの型の名前を宣言なしに参照するため、照合の中でだけ環境の検証が使う構造的な型として宣言する
declare global {
  type Service = ServiceFetcher;
  type RateLimit = RateLimiter;
}

type SchemaKey = keyof FrontendEnvInput;

type RequiredSchemaKey = {
  [K in SchemaKey]-?: object extends Pick<FrontendEnvInput, K> ? never : K;
}[SchemaKey];

// 宣言の無い型の名前は型の定義ファイルの検査を省く設定では警告されず、どの型へも代入できる型になって代入の照合を素通りするため検出する。この型は`0 extends 1 & T`の判定では見分けられず、どの値も満たさない型への代入の可否で見分ける
declare const unmatchable: unique symbol;
type IsUntyped<T> = [T] extends [{ readonly [unmatchable]: never }]
  ? true
  : false;

type KeysOutsideSchema = Exclude<keyof Env, SchemaKey>;

type MissingRequiredKeys = Exclude<RequiredSchemaKey, keyof Env>;

type UnassignableKeys = {
  [K in keyof Env & SchemaKey]-?: Env[K] extends FrontendEnvInput[K]
    ? never
    : K;
}[keyof Env & SchemaKey];

type UntypedKeys = {
  [K in keyof Env]-?: IsUntyped<Env[K]> extends true ? K : never;
}[keyof Env];

type NoKeys<Keys extends never> = Keys;

export type WorkerEnvContract = [
  NoKeys<KeysOutsideSchema>,
  NoKeys<MissingRequiredKeys>,
  NoKeys<UnassignableKeys>,
  NoKeys<UntypedKeys>,
];
