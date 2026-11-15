import type { HelpAuthorView } from '../../../../application/help/help-authors.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import { mediaFileLoader } from '../media/loaders.ts';
import { toMediaImage } from '../media/mappers.ts';

// 画像は要求されたときだけ読むため、作成者は画像のIDを持つ照会の結果のまま渡す
export type HelpArticleAuthorSource = HelpAuthorView;

// 管理者側と利用者側の作成者で共用する。一覧の各行で要求されるため、一括読み込みで1回の照会にまとめる
export const helpAuthorFieldResolvers = {
  HelpArticleAuthor: {
    avatar: async (author, _args, context) => {
      if (author.avatarFileId === null) {
        return null;
      }
      const file = await context.loaders
        .get(mediaFileLoader)
        .load(author.avatarFileId);
      return file === null ? null : toMediaImage(file);
    },
  },
} satisfies Resolvers;
