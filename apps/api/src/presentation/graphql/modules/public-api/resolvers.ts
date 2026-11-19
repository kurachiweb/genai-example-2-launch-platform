import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { toApiKey } from './api-key-views.ts';
import {
  API_KEY_ID_ARGS,
  ISSUE_API_KEY_ARGS,
  MY_API_KEYS_ARGS,
  UPDATE_API_KEY_ARGS,
} from './inputs.ts';
import {
  accountGuardOf,
  clientOnly,
  clockOf,
  managementOf,
} from './resolver-support.ts';

// ユースケースは項目の誤りの欄を入力からの相対の経路(name・scopes.<機能>)で返すため、引数の検証と同じinput.からの経路に直す
const INPUT_PATH = 'input';

// 停止中の利用者にも一覧と削除を許し、漏洩したキーを停止中でも無効にできるようにする。発行・編集・再発行は停止中を拒否する。
// メールアドレスの確認は求めない
export const publicApiResolvers = {
  Query: {
    myApiKeys: clientOnly(
      withValidatedArgs(
        MY_API_KEYS_ARGS,
        async (_parent: unknown, { first, after }, context) => {
          const user = await accountGuardOf(context).requireUser(
            context.session,
          );
          const page = await managementOf(context).list(user, {
            first,
            after,
          });
          return {
            nodes: page.nodes.map(toApiKey),
            pageInfo: {
              hasNextPage: page.hasNextPage,
              endCursor: page.endCursor,
            },
          };
        },
      ),
    ),
  },
  Mutation: {
    issueApiKey: clientOnly(
      withValidatedArgs(
        ISSUE_API_KEY_ARGS,
        async (_parent: unknown, { input }, context) => {
          const user = await accountGuardOf(context).requireWritableUser(
            context.session,
          );
          const issued = await withInputPath(INPUT_PATH, () =>
            managementOf(context).issue(user, input, clockOf(context).now()),
          );
          return {
            apiKey: toApiKey(issued.apiKey),
            plainKey: issued.plainKey,
          };
        },
      ),
    ),
    updateApiKey: clientOnly(
      withValidatedArgs(
        UPDATE_API_KEY_ARGS,
        async (_parent: unknown, { id, input }, context) => {
          const user = await accountGuardOf(context).requireWritableUser(
            context.session,
          );
          const view = await withInputPath(INPUT_PATH, () =>
            managementOf(context).update(
              user,
              id,
              input,
              clockOf(context).now(),
            ),
          );
          return toApiKey(view);
        },
      ),
    ),
    reissueApiKey: clientOnly(
      withValidatedArgs(
        API_KEY_ID_ARGS,
        async (_parent: unknown, { id }, context) => {
          const user = await accountGuardOf(context).requireWritableUser(
            context.session,
          );
          const issued = await managementOf(context).reissue(
            user,
            id,
            clockOf(context).now(),
          );
          return {
            apiKey: toApiKey(issued.apiKey),
            plainKey: issued.plainKey,
          };
        },
      ),
    ),
    deleteApiKey: clientOnly(
      withValidatedArgs(
        API_KEY_ID_ARGS,
        async (_parent: unknown, { id }, context) => {
          const user = await accountGuardOf(context).requireUser(
            context.session,
          );
          await managementOf(context).delete(user, id);
          return id;
        },
      ),
    ),
  },
} satisfies Resolvers;
