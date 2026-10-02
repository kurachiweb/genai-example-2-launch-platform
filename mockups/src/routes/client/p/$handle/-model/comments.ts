import { USERS } from '#/lib/mock-data';
import type { User } from '#/lib/mock-data';

import { addMinutes } from './clock';
import {
  COMMENT_BODIES,
  LONG_COMMENT_BODIES,
  MAKER_REPLIES,
  MAKER_UPDATE_BODY,
  OWN_COMMENT_BODY,
  REPLY_BODIES,
} from './content';
import type { ProductSearch } from './options';

export type CommentNode = {
  id: string;
  // 退会・停止・本人削除・管理者による非公開化で置き換え表示する場合はnull(FR-COMNT-007)
  author: User | null;
  body: string;
  createdAt: Date;
  edited: boolean;
  isOwn: boolean;
  isMaker: boolean;
  replies: CommentNode[];
};

type BuildOptions = {
  launchId: string;
  count: number;
  replies: ProductSearch['replies'];
  long: boolean;
  // 自分のコメントを持てる閲覧者(メールアドレス確認済みのログインユーザー)
  viewer: User | null;
  maker: User;
  latestAt: Date;
  // ローンチ日より前のコメントにならないよう、投稿日時をこの時刻以降に収める
  earliestAt: Date;
};

const TOP_LEVEL_INTERVAL_MINUTES = 137;
const REPLY_DELAY_MINUTES = 41;
const OWN_COMMENT_INDEX = 1;
const MAKER_COMMENT_INDEX = 3;

export function buildComments({
  launchId,
  count,
  replies,
  long,
  viewer,
  maker,
  latestAt,
  earliestAt,
}: BuildOptions): CommentNode[] {
  const spanMinutes = (latestAt.getTime() - earliestAt.getTime()) / 60000;
  const interval = Math.max(
    1,
    Math.min(TOP_LEVEL_INTERVAL_MINUTES, spanMinutes / Math.max(1, count)),
  );
  const replyDelay = Math.min(REPLY_DELAY_MINUTES, interval / 3);
  const pool = USERS.slice(1).filter(
    (user) => user.id !== maker.id && user.id !== viewer?.id,
  );
  const node = (
    id: string,
    author: User | null,
    body: string,
    createdAt: Date,
    children: CommentNode[] = [],
    edited = false,
  ): CommentNode => ({
    id: `${launchId}-${id}`,
    author,
    body: author ? body : '',
    createdAt,
    edited,
    isOwn: author != null && author.id === viewer?.id,
    isMaker: author != null && author.id === maker.id,
    replies: children,
  });

  const replyTree = (index: number, at: Date): CommentNode[] => {
    if (replies === 'none') return [];
    const deleted = replies === 'deleted';
    const first = addMinutes(at, replyDelay);
    const second = addMinutes(first, replyDelay);
    if (index === 0) {
      return [
        node(`${index}-r1`, maker, MAKER_REPLIES[0], first, [
          node(
            `${index}-r1-r1`,
            pool[5 % pool.length],
            REPLY_BODIES[2],
            second,
          ),
        ]),
      ];
    }
    if (index === 2) {
      return [
        node(
          `${index}-r1`,
          deleted ? null : pool[6 % pool.length],
          REPLY_BODIES[0],
          first,
          deleted
            ? [
                node(
                  `${index}-r1-r1`,
                  pool[7 % pool.length],
                  REPLY_BODIES[3],
                  second,
                ),
              ]
            : [],
        ),
        node(
          `${index}-r2`,
          viewer ?? pool[8 % pool.length],
          REPLY_BODIES[1],
          second,
        ),
      ];
    }
    if (index === 4) {
      return [node(`${index}-r1`, maker, MAKER_REPLIES[1], first)];
    }
    return [];
  };

  return Array.from({ length: count }, (_, index) => {
    const createdAt = addMinutes(latestAt, -(index + 1) * interval);
    const isOwn = index === OWN_COMMENT_INDEX && viewer != null;
    const isMaker = index === MAKER_COMMENT_INDEX;
    const author = isOwn
      ? viewer
      : isMaker
        ? maker
        : pool[(index * 3) % pool.length];
    const body = isOwn
      ? OWN_COMMENT_BODY
      : isMaker
        ? MAKER_UPDATE_BODY
        : long && index % 3 === 0
          ? LONG_COMMENT_BODIES[(index / 3) % LONG_COMMENT_BODIES.length]
          : COMMENT_BODIES[index % COMMENT_BODIES.length];
    // 返信を残したまま置き換え表示するコメントと、返信の無いまま置き換え表示するコメント
    const removed = replies === 'deleted' && (index === 0 || index === 5);
    return node(
      `${index}`,
      removed ? null : author,
      body,
      createdAt,
      replyTree(index, createdAt),
      isOwn || index % 5 === 2,
    );
  });
}

const SUPPORTER_FIRST_NAMES = [
  'Avery',
  'Benjamin',
  'Chloé',
  'Dmitri',
  'Esperanza',
  'Felix',
  'Giulia',
  'Haruto',
  'Ingrid',
  'Jamal',
  'Keiko',
  'Leonardo',
  'Maximilianus',
  'Nadia',
  'Oscar',
  'Padmavathi',
  'Quentin',
  'Rosalind',
  'Santiago',
  'Thandiwe',
];

// サポーター一覧(FR-DIR-004)の仮データ。Upvoteした日時が早い順
export function supportersOf(matchId: string, count: number): User[] {
  return Array.from({ length: count }, (_, index) => {
    const name = SUPPORTER_FIRST_NAMES[index % SUPPORTER_FIRST_NAMES.length];
    const round = Math.floor(index / SUPPORTER_FIRST_NAMES.length);
    const nickname =
      round === 0 ? name : `${name} ${String.fromCharCode(64 + round)}.`;
    return {
      id: `${matchId}-supporter-${index + 1}`,
      nickname,
      handle: `${asciiHandle(name)}${round === 0 ? '' : round}`,
      art: index % 4 === 3 ? null : { palette: (index * 7) % 12 },
    };
  });
}

// ハンドルは英数字・ハイフン・アンダースコアのみのため、アクセント記号を外して小文字化する
function asciiHandle(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}
