import { useState } from 'react';
import {
  EllipsisIcon,
  FlagIcon,
  MessageSquareOffIcon,
  PencilIcon,
  ReplyIcon,
  Trash2Icon,
} from 'lucide-react';

import { Markdown } from '#/components/client/markdown';
import { UserAvatar } from '#/components/client/user-avatar';
import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip';
import { useDateTimeFormatter } from '#/lib/date-format';
import { UNVERIFIED_MESSAGE } from '#/lib/messages';
import { formatElapsed } from '#/lib/relative-time';
import { cn } from '#/lib/utils';

import type { CommentNode } from '../-model/comments';
import { CommentComposer } from './comment-composer';
import { DeleteCommentDialog } from './delete-comment-dialog';
import { usePageContext } from './page-context';

export type CommentActions = {
  reply: (parentId: string, body: string) => void;
  edit: (id: string, body: string) => void;
  remove: (id: string) => void;
};

type Props = {
  node: CommentNode;
  depth: number;
  actions: CommentActions;
};

// 返信は3階層まで(FR-COMNT-002)
const MAX_DEPTH = 3;

export function CommentItem({ node, depth, actions }: Props) {
  const { role, now, imagesBroken, requireLogin, openReport } =
    usePageContext();
  const fullFormatter = useDateTimeFormatter('longDateTime');
  const dateFormatter = useDateTimeFormatter('dateWeekday');
  const [mode, setMode] = useState<'view' | 'reply' | 'edit'>('view');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { author } = node;
  const canReply = depth < MAX_DEPTH;

  const handleReply = () => {
    if (role === 'guest') {
      requireLogin('comment');
      return;
    }
    setMode('reply');
  };

  return (
    <li>
      <article
        aria-label={
          author ? `${author.nickname}さんのコメント` : '削除されたコメント'
        }
        className="flex gap-3"
      >
        {author ? (
          <UserAvatar user={author} size={36} broken={imagesBroken} />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageSquareOffIcon className="size-4" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {author ? (
            <>
              <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <a
                  href="#"
                  className="font-bold wrap-anywhere text-foreground no-underline hover:underline"
                >
                  {author.nickname}
                </a>
                {node.isMaker && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                    投稿者
                  </span>
                )}
                {node.isOwn && !node.isMaker && (
                  <span className="rounded-full border border-primary/50 px-2 py-0.5 text-[11px] font-bold text-primary">
                    あなた
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <time
                      tabIndex={0}
                      dateTime={node.createdAt.toISOString()}
                      className="text-xs text-muted-foreground"
                    >
                      {formatElapsed(node.createdAt, now) ??
                        dateFormatter.format(node.createdAt)}
                    </time>
                  </TooltipTrigger>
                  <TooltipContent>
                    {fullFormatter.format(node.createdAt)}
                  </TooltipContent>
                </Tooltip>
                {node.edited && (
                  <span className="text-xs text-muted-foreground">
                    (編集済み)
                  </span>
                )}
              </header>
              {mode === 'edit' ? (
                <div className="mt-2">
                  <CommentComposer
                    submitLabel="保存する"
                    placeholder="コメントを編集"
                    initialBody={node.body}
                    autoFocus
                    onCancel={() => setMode('view')}
                    onSubmit={(body) => {
                      actions.edit(node.id, body);
                      setMode('view');
                    }}
                  />
                </div>
              ) : (
                <Markdown size="sm" externalRel="noopener ugc" className="mt-1">
                  {node.body}
                </Markdown>
              )}
              {mode !== 'edit' && (
                <div className="mt-1 flex items-center gap-1">
                  {canReply && (
                    <ReplyButton
                      disabled={role === 'unverified'}
                      onClick={handleReply}
                    />
                  )}
                  <CommentMenu
                    own={node.isOwn}
                    onEdit={() => setMode('edit')}
                    onDelete={() => setConfirmDelete(true)}
                    onReport={() =>
                      openReport({
                        kind: 'comment',
                        label: `${author.nickname}さんのコメント`,
                      })
                    }
                  />
                </div>
              )}
            </>
          ) : (
            <p className="py-1.5 text-sm text-muted-foreground italic">
              このコメントは削除されました。
            </p>
          )}
          {mode === 'reply' && (
            <div className="mt-2">
              <CommentComposer
                submitLabel="返信する"
                placeholder="返信を書く"
                autoFocus
                onCancel={() => setMode('view')}
                onSubmit={(body) => {
                  actions.reply(node.id, body);
                  setMode('view');
                }}
              />
            </div>
          )}
        </div>
      </article>
      {node.replies.length > 0 && (
        <ol
          aria-label="返信"
          className={cn(
            'mt-4 ml-[1.0625rem] space-y-4 border-l-2 border-border pl-3 sm:pl-5',
          )}
        >
          {node.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              node={reply}
              depth={depth + 1}
              actions={actions}
            />
          ))}
        </ol>
      )}
      <DeleteCommentDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => actions.remove(node.id)}
      />
    </li>
  );
}

function ReplyButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  const button = (
    <Button size="xs" variant="ghost" disabled={disabled} onClick={onClick}>
      <ReplyIcon aria-hidden="true" />
      返信
    </Button>
  );
  if (!disabled) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{UNVERIFIED_MESSAGE}</TooltipContent>
    </Tooltip>
  );
}

function CommentMenu({
  own,
  onEdit,
  onDelete,
  onReport,
}: {
  own: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="コメントの操作">
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {own ? (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <PencilIcon />
              編集
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon />
              削除
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={onReport}>
            <FlagIcon />
            通報
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
