import { z } from 'zod';

import {
  type MarkdownTextRule,
  markdownTextSchema,
} from '../validation/markdown-text-schema.ts';

export const COMMENT_MAX_GRAPHEMES = 2000;

export const COMMENT_PAGE_SIZE = 10;

export const COMMENT_MAX_DEPTH = 3;

export const RATING_SCORES = Object.freeze([1, 2, 3, 4, 5] as const);

export type RatingScore = (typeof RATING_SCORES)[number];

export const COMMENT_BODY_RULE: MarkdownTextRule = Object.freeze({
  label: 'コメント',
  maxGraphemes: COMMENT_MAX_GRAPHEMES,
  required: true,
});

export const commentBodySchema = (): z.ZodType<string> =>
  markdownTextSchema(COMMENT_BODY_RULE);

const RATING_SCORE_MESSAGE = '評価は1〜5で選んでください。';

export const ratingScoreSchema = (): z.ZodType<RatingScore> =>
  z.literal(RATING_SCORES, { error: RATING_SCORE_MESSAGE });

export const COMMENT_BOT_ACTIONS = Object.freeze({
  post: 'comment_post',
  edit: 'comment_edit',
  delete: 'comment_delete',
} as const);

// 見出しのアンカーの接頭辞はidScopeの規則(英小文字と数字の32文字以内)に従うため、26文字のULIDを小文字にして1文字を前置する
export const commentIdScope = (commentId: string): string =>
  `c${commentId.toLowerCase()}`;

const COMMENT_COMPOSER_ID_SCOPE_PREFIXES = Object.freeze({
  post: 'p',
  reply: 'r',
  edit: 'e',
} as const);

export type CommentComposerMode =
  keyof typeof COMMENT_COMPOSER_ID_SCOPE_PREFIXES;

// 1つのページに複数の投稿欄・返信の欄・編集の欄のプレビューが同時に開くため、投稿先のローンチ・返信先・編集するコメントのIDで欄ごとに分け、欄の種類ごとの1文字でコメントの本文のcと分ける
export const commentComposerIdScope = (
  mode: CommentComposerMode,
  targetId: string,
): string =>
  `${COMMENT_COMPOSER_ID_SCOPE_PREFIXES[mode]}${targetId.toLowerCase()}`;

export const LAUNCH_NOT_COMMENTABLE_MESSAGE =
  'キックオフ後にコメントできるようになります。';

export const OWN_PRODUCT_RATING_MESSAGE = '自身のプロダクトは評価できません。';
