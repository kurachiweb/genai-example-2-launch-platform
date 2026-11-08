import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { FOLLOWERS_LIST_HREF } from './profile-paths.ts';
import {
  FOLLOWER_LABEL,
  FOLLOWER_LINK_TITLE,
  FOLLOWER_UNIT,
} from './profile-messages.ts';

export interface FollowerCountProps {
  readonly count: number;
  // フォロー・フォロワーの一覧は本人の設定ページでだけ閲覧できるため、本人にだけリンクにする
  readonly linked: boolean;
}

const COUNT_FORMAT = new Intl.NumberFormat('ja-JP');

const ROW_CLASS_NAME = 'flex items-baseline gap-1.5';

export function FollowerCount({ count, linked }: FollowerCountProps) {
  const content = (
    <>
      <span className="text-sm text-muted-foreground">{FOLLOWER_LABEL}</span>
      <span className="text-xl leading-none font-extrabold tabular-nums">
        {COUNT_FORMAT.format(count)}
        <span className="ml-0.5 text-sm font-bold">{FOLLOWER_UNIT}</span>
      </span>
    </>
  );
  if (!linked) {
    return <p className={ROW_CLASS_NAME}>{content}</p>;
  }
  return (
    <PathLink
      href={FOLLOWERS_LIST_HREF}
      title={FOLLOWER_LINK_TITLE}
      className={`${ROW_CLASS_NAME} rounded-md text-foreground no-underline hover:underline`}
    >
      {content}
    </PathLink>
  );
}
