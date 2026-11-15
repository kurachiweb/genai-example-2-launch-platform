import type { GraphQLResolveInfo } from 'graphql';

import { INQUIRY_ATTACHMENT_LIMITS } from '../../../../../common-lib/inquiry/inquiry-attachment-limits.ts';
import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../../../lib/core/identity/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import { inquiryAttachmentsInvalidError } from '../../../../application/inquiry/inquiry-errors.ts';
import type { InquiryRequestMeta } from '../../../../application/inquiry/inquiry-request-meta.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { mediaFileLoader } from '../media/loaders.ts';
import { type MediaImageModel, toMediaImage } from '../media/mappers.ts';
import { callerForbiddenError } from './errors.ts';
import { inquiryCategoryLoader } from './loaders.ts';
import { type InquiryCategoryModel, toInquiryCategory } from './mappers.ts';

// 期待する操作名は、利用者側の画面がbot判定の部品に渡す名前と同じにする。未ログインとログインの送信で判定の結果を流用させないよう、別の名前にする
export const INQUIRY_BOT_ACTIONS = Object.freeze({
  guest: 'inquiry_guest',
  member: 'inquiry_member',
});

export type InquiryBotAction =
  (typeof INQUIRY_BOT_ACTIONS)[keyof typeof INQUIRY_BOT_ACTIONS];

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// 利用者側の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とbot判定より前に拒否する
export function clientOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'client') {
      throw callerForbiddenError();
    }
    return resolve(parent, args, context, info);
  };
}

// 管理者側の操作は管理者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とロールの確認より前に拒否する
export function adminOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'admin') {
      throw callerForbiddenError();
    }
    return resolve(parent, args, context, info);
  };
}

export async function categoryOf(
  parent: { readonly categoryId: string },
  context: GraphQLContext,
): Promise<InquiryCategoryModel> {
  return toInquiryCategory(
    await context.loaders.get(inquiryCategoryLoader).load(parent.categoryId),
  );
}

export function assertHuman(
  context: GraphQLContext,
  action: InquiryBotAction,
): Promise<void> {
  return context.assertHuman(action);
}

export const accountGuardOf = (context: GraphQLContext): AccountGuard =>
  context.resolve<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard);

export function inquiryRequestMetaOf(
  context: GraphQLContext,
): InquiryRequestMeta {
  return {
    clientIp: context.clientIp,
    now: context.resolve<Clock>(PLATFORM_TYPES.Clock).now(),
  };
}

// 件数の超過はファイルを照会せずに分かるため、bot判定のトークンを使う前に拒否する。件数は添付の検証と同じく重複を除いて数える
export function assertAttachmentCount(fileIds: readonly string[]): void {
  if (new Set(fileIds).size > INQUIRY_ATTACHMENT_LIMITS.maxCount) {
    throw inquiryAttachmentsInvalidError({ kind: 'too-many' }, fileIds);
  }
}

// プロフィール画像は一覧の各行で要求されるため、一括読み込みで1回の照会にまとめる
export async function avatarOf(
  parent: { readonly avatarFileId: string | null },
  context: GraphQLContext,
): Promise<MediaImageModel | null> {
  if (parent.avatarFileId === null) {
    return null;
  }
  const file = await context.loaders
    .get(mediaFileLoader)
    .load(parent.avatarFileId);
  return file === null ? null : toMediaImage(file);
}
