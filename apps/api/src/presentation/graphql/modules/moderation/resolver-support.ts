import type { GraphQLResolveInfo } from 'graphql';

import type { AdminRole } from '../../../../../common-lib/admin/admin-roles.ts';
import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import type { ModerationOperator } from '../../../../application/moderation/ports.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import type { Connection } from '../../pagination.ts';

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// 措置の群の照会と操作は管理者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とロールの確認より前に拒否する
export function adminOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'admin') {
      throw authError('forbidden');
    }
    return resolve(parent, args, context, info);
  };
}

// ロールの不足の拒否のログを残す認可の入口で確かめ、措置の記録と監査ログの操作者にする
export async function moderationOperatorOf(
  context: GraphQLContext,
  minimum: AdminRole,
): Promise<ModerationOperator> {
  const admin = await requireAdmin(context, minimum);
  return { adminId: admin.id };
}

export const clockOf = (context: GraphQLContext): Clock =>
  context.resolve<Clock>(PLATFORM_TYPES.Clock);

// 上流の照会は表示する項目と続きの位置だけを返すため、1件多く読んだ行を前提にするtoConnectionを使わずに組み立てる。位置は上流の値をそのまま中継する
export function toModerationConnection<TItem, TNode>(
  items: readonly TItem[],
  nextCursor: string | null | undefined,
  toNode: (item: TItem) => TNode,
): Connection<TNode> {
  return {
    nodes: items.map(toNode),
    pageInfo: {
      hasNextPage: nextCursor != null,
      endCursor: nextCursor ?? null,
    },
  };
}
