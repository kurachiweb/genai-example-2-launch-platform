import { Link, useLocation } from '@tanstack/react-router';
import { MessageSquareOffIcon, ReplyIcon } from 'lucide-react';
import {
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { commentIdScope } from '../../../common-lib/engagement/engagement-rules.ts';
import { MarkdownContent } from '../../../lib/components/markdown/markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Tooltip } from '../../../lib/components/ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../../../lib/components/ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../../../lib/components/ui/tooltip/tooltip-trigger.tsx';
import type { LaunchCommentFragment } from '../../graphql/generated/graphql.ts';
import { LoginRequiredDialog } from '../auth/login-required-dialog.tsx';
import { UserAvatar } from '../profile/user-avatar.tsx';
import type { CommentAction } from './comment-action-types.ts';
import { CommentComposer } from './comment-composer.tsx';
import { CommentMenu } from './comment-menu.tsx';
import {
  COMMENT_EDITED_MARK,
  COMMENT_EMAIL_UNVERIFIED_REASON,
  COMMENT_LOGIN_REQUIRED_DESCRIPTION,
  COMMENT_LOGIN_REQUIRED_TITLE,
  COMMENT_PRODUCT_OWNER_BADGE,
  COMMENT_REPLIES_LABEL,
  COMMENT_REPLY_LABEL,
  COMMENT_VIEWER_BADGE,
  commentLabelOf,
  REMOVED_COMMENT_LABEL,
  REMOVED_COMMENT_MESSAGE,
} from './comment-messages.ts';
import { CommentTime } from './comment-time.tsx';
import type { CommentTreeNode } from './comment-tree.ts';
import type { CommentMutations } from './use-comment-mutations.ts';
import { useEngagementViewer } from './use-engagement-viewer.ts';

export type CommentItemMutations = Pick<
  CommentMutations,
  'reply' | 'update' | 'remove'
>;

export interface CommentItemProps {
  readonly node: CommentTreeNode;
  readonly product: { readonly id: string; readonly handle: string };
  readonly launch: { readonly id: string };
  readonly viewerIsOwner: boolean;
  // ログイン中の閲覧者の返信・編集・削除の操作。未ログインの閲覧者はnull
  readonly mutations: CommentItemMutations | null;
  // 他者のコメントの操作の登録口(COMMENT_ACTIONS)
  readonly actions?: readonly CommentAction[];
}

// 返信は3階層まで
const MAX_DEPTH = 3;

const ARTICLE_CLASS = 'flex gap-3 rounded-md';

const AVATAR_CLASS = 'size-9 shrink-0';

type ItemMode = 'view' | 'reply' | 'edit';

type FocusTarget = 'reply' | 'article';

interface ShownComment extends LaunchCommentFragment {
  readonly author: NonNullable<LaunchCommentFragment['author']>;
  readonly body: string;
  readonly createdAt: string;
}

// 作者・本文・日時のどれかが取れない表示中のコメントも、事情を推測させないよう置き換え表示にする
const shownCommentOf = (
  comment: LaunchCommentFragment,
): ShownComment | null => {
  const { author, body, createdAt } = comment;
  if (
    comment.state !== 'SHOWN' ||
    author === null ||
    body === null ||
    createdAt === null
  ) {
    return null;
  }
  return { ...comment, author, body, createdAt };
};

function CommentBody({
  id,
  body,
}: {
  readonly id: string;
  readonly body: string;
}) {
  // 1つのページに並ぶ他のコメントや説明文と見出しのアンカーが重ならないよう、コメントごとの識別子を接頭辞にする
  const options = useMarkdownOptions({
    externalLinkRel: ['noopener', 'ugc'],
    idScope: commentIdScope(id),
  });
  const rendered = useRenderedMarkdown(body, options);
  return <MarkdownContent rendered={rendered} size="sm" className="mt-1" />;
}

function CommentHeader({ comment }: { readonly comment: ShownComment }) {
  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      <Link
        to="/@{$handle}"
        params={{ handle: comment.author.handle }}
        className="rounded-sm font-bold wrap-anywhere text-foreground no-underline hover:underline"
      >
        {comment.author.nickname}
      </Link>
      {comment.byProductOwner ? (
        <Badge>{COMMENT_PRODUCT_OWNER_BADGE}</Badge>
      ) : comment.viewerIsAuthor ? (
        <Badge variant="outline" className="border-primary/60">
          {COMMENT_VIEWER_BADGE}
        </Badge>
      ) : null}
      <CommentTime value={comment.createdAt} />
      {comment.edited ? (
        <span className="text-xs text-muted-foreground">
          {COMMENT_EDITED_MARK}
        </span>
      ) : null}
    </header>
  );
}

interface ReplyButtonProps {
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
  readonly unverified: boolean;
  readonly onReply: () => void;
}

// 押せない理由をツールチップで示すため、Tabの停止位置とポインターの事象を残すdisabledではなくaria-disabledにし、押下は受け側で無視する。aria-disabledのボタンはポインターを受けないため、外枠をツールチップの起点にする
function ReplyButton({ buttonRef, unverified, onReply }: ReplyButtonProps) {
  const reasonId = useId();
  const button = (
    <Button
      ref={buttonRef}
      type="button"
      size="xs"
      variant="ghost"
      aria-disabled={unverified || undefined}
      aria-describedby={unverified ? reasonId : undefined}
      onClick={() => {
        if (!unverified) {
          onReply();
        }
      }}
    >
      <ReplyIcon aria-hidden="true" />
      {COMMENT_REPLY_LABEL}
    </Button>
  );
  if (!unverified) {
    return button;
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex rounded-md">{button}</span>
        </TooltipTrigger>
        <TooltipContent>{COMMENT_EMAIL_UNVERIFIED_REASON}</TooltipContent>
      </Tooltip>
      {/* 本文としては読み上げさせず、説明の参照先にだけ使う */}
      <span id={reasonId} hidden>
        {COMMENT_EMAIL_UNVERIFIED_REASON}
      </span>
    </>
  );
}

function GuestLoginDialog({
  open,
  onOpenChange,
  returnFocusRef,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const returnTo = useLocation({
    select: ({ pathname, searchStr }) => `${pathname}${searchStr}`,
  });
  return (
    <LoginRequiredDialog
      open={open}
      onOpenChange={onOpenChange}
      title={COMMENT_LOGIN_REQUIRED_TITLE}
      description={COMMENT_LOGIN_REQUIRED_DESCRIPTION}
      returnTo={returnTo}
      returnFocusRef={returnFocusRef}
    />
  );
}

function RemovedCommentBody() {
  return (
    <>
      <span
        aria-hidden="true"
        className={`${AVATAR_CLASS} flex items-center justify-center rounded-full bg-muted text-muted-foreground`}
      >
        <MessageSquareOffIcon className="size-4" />
      </span>
      <p className="min-w-0 flex-1 py-1.5 text-sm text-muted-foreground italic">
        {REMOVED_COMMENT_MESSAGE}
      </p>
    </>
  );
}

// 返信の一覧を項目の中に入れ子で持つ。置き換え表示の項目は本文・作者・日時・印・操作を出さず、返信の一覧だけを残す
export function CommentItem({
  node,
  product,
  launch,
  viewerIsOwner,
  mutations,
  actions,
}: CommentItemProps) {
  const { comment, replies } = node;
  const shown = shownCommentOf(comment);
  const { kind } = useEngagementViewer({ viewer: { isOwner: viewerIsOwner } });
  const articleRef = useRef<HTMLElement>(null);
  const replyButtonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<ItemMode>('view');
  const [loginOpen, setLoginOpen] = useState(false);
  const focusAfterCloseRef = useRef<FocusTarget | null>(null);
  // 削除に成功すると「…」が外れて確認のダイアログの戻り先が無くなるため、置き換え表示に変わった項目へフォーカスを移す
  const removingRef = useRef(false);
  const removed = shown === null;
  const signedInMutations = kind === 'guest' ? null : mutations;

  useLayoutEffect(() => {
    if (removed && removingRef.current) {
      removingRef.current = false;
      articleRef.current?.focus();
    }
  }, [removed]);

  // 閉じた投稿欄の中のフォーカスを<body>へ落とさず、開いた元の操作の続きへ移す
  useLayoutEffect(() => {
    const target = focusAfterCloseRef.current;
    if (mode !== 'view' || target === null) {
      return;
    }
    focusAfterCloseRef.current = null;
    (target === 'reply' ? replyButtonRef : articleRef).current?.focus();
  }, [mode]);

  const closeComposer = (target: FocusTarget) => {
    focusAfterCloseRef.current = target;
    setMode('view');
  };

  const handleReply = () => {
    if (kind === 'guest') {
      setLoginOpen(true);
      return;
    }
    setMode('reply');
  };

  const canReply =
    shown !== null &&
    comment.depth < MAX_DEPTH &&
    (kind === 'guest' || signedInMutations !== null);

  const renderShown = (current: ShownComment) => (
    <>
      <span aria-hidden="true" className="shrink-0">
        <UserAvatar user={current.author} size={32} className={AVATAR_CLASS} />
      </span>
      <div className="min-w-0 flex-1">
        <CommentHeader comment={current} />
        {mode === 'edit' && signedInMutations !== null ? (
          <div className="mt-2">
            <CommentComposer
              target={{
                mode: 'edit',
                body: current.body,
                topLevel: current.depth === 1,
                onCancel: () => {
                  closeComposer('article');
                },
              }}
              productId={product.id}
              viewerIsOwner={viewerIsOwner}
              onSubmit={async (submission) => {
                await signedInMutations.update(current.id, submission);
                closeComposer('article');
              }}
            />
          </div>
        ) : (
          <>
            <CommentBody id={current.id} body={current.body} />
            <div className="mt-1 flex items-center gap-1">
              {canReply ? (
                <ReplyButton
                  buttonRef={replyButtonRef}
                  unverified={kind === 'unverified'}
                  onReply={handleReply}
                />
              ) : null}
              <CommentMenu
                context={{
                  comment: {
                    id: current.id,
                    authorNickname: current.author.nickname,
                  },
                  product,
                  launch,
                }}
                viewerIsAuthor={
                  current.viewerIsAuthor && signedInMutations !== null
                }
                onEdit={() => {
                  setMode('edit');
                }}
                onDelete={async (turnstileToken) => {
                  if (signedInMutations === null) {
                    return;
                  }
                  removingRef.current = true;
                  try {
                    await signedInMutations.remove(current.id, turnstileToken);
                  } catch (error) {
                    removingRef.current = false;
                    throw error;
                  }
                }}
                {...(actions === undefined ? {} : { actions })}
              />
            </div>
          </>
        )}
        {mode === 'reply' && signedInMutations !== null ? (
          <div className="mt-2">
            <CommentComposer
              target={{
                mode: 'reply',
                onCancel: () => {
                  closeComposer('reply');
                },
              }}
              productId={product.id}
              viewerIsOwner={viewerIsOwner}
              onSubmit={async (submission) => {
                await signedInMutations.reply(current.id, submission);
                closeComposer('reply');
              }}
            />
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <li>
      <article
        ref={articleRef}
        tabIndex={-1}
        aria-label={
          shown === null
            ? REMOVED_COMMENT_LABEL
            : commentLabelOf(shown.author.nickname)
        }
        className={ARTICLE_CLASS}
      >
        {shown === null ? <RemovedCommentBody /> : renderShown(shown)}
      </article>
      {replies.length > 0 ? (
        <ol
          aria-label={COMMENT_REPLIES_LABEL}
          className="mt-4 ml-[1.0625rem] space-y-4 border-l-2 border-border pl-3 sm:pl-5"
        >
          {replies.map((reply) => (
            <CommentItem
              key={reply.comment.id}
              node={reply}
              product={product}
              launch={launch}
              viewerIsOwner={viewerIsOwner}
              mutations={mutations}
              {...(actions === undefined ? {} : { actions })}
            />
          ))}
        </ol>
      ) : null}
      {kind === 'guest' ? (
        <GuestLoginDialog
          open={loginOpen}
          onOpenChange={setLoginOpen}
          returnFocusRef={replyButtonRef}
        />
      ) : null}
    </li>
  );
}
