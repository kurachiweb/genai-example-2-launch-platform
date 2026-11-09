import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import type { LaunchPlanView } from '../../graphql/my-products.ts';
import { myProductEditHref } from '../layout/site-links.ts';
import { LaunchDateText } from './launch-date-text.tsx';
import {
  EARLIEST_LAUNCH_DATE_NOTICE,
  PLAN_UNKNOWN_NOTICE,
  RELEASE_PREFIX,
  RESCHEDULE_NOTICE,
  RESERVE_NEXT_LAUNCH_LABEL,
} from './launch-messages.ts';
import type { MyProductSectionContext } from './product-section-types.ts';
import { RemainingDateTime } from './remaining-date-time.tsx';

export interface LaunchPlanNoticeProps {
  readonly plan: LaunchPlanView;
  readonly productHandle: string;
  // 編集画面ではローンチ日の欄で予約するため、編集画面への導線を出さない
  readonly placement: MyProductSectionContext['placement'];
  // 停止中の利用者は予約を含めて変更できないため、一覧でも編集画面への導線を出さない。既定は真
  readonly editable?: boolean;
}

function NewLaunchNotice({
  plan,
  productHandle,
  placement,
  editable = true,
}: LaunchPlanNoticeProps) {
  return (
    <>
      {plan.window !== null && (
        <p>
          {EARLIEST_LAUNCH_DATE_NOTICE.before}
          <LaunchDateText date={plan.window.earliest} />
          {EARLIEST_LAUNCH_DATE_NOTICE.after}
        </p>
      )}
      {placement === 'list' && editable && (
        <p>
          <PathLink
            href={myProductEditHref(productHandle)}
            className={INLINE_LINK_CLASS_NAME}
          >
            {RESERVE_NEXT_LAUNCH_LABEL}
          </PathLink>
        </p>
      )}
    </>
  );
}

function BlockedNotice({ blocks }: Pick<LaunchPlanView, 'blocks'>) {
  return blocks.map(({ code, message, releaseAt }) => (
    <div key={code}>
      <p>{message}</p>
      {releaseAt !== null && (
        <p>
          {RELEASE_PREFIX}
          <RemainingDateTime at={releaseAt} />
        </p>
      )}
    </div>
  ));
}

function PlanNotice(props: LaunchPlanNoticeProps) {
  switch (props.plan.mode) {
    case 'new':
      return <NewLaunchNotice {...props} />;
    case 'reschedule':
      return <p>{RESCHEDULE_NOTICE}</p>;
    case 'blocked':
      return <BlockedNotice blocks={props.plan.blocks} />;
    case 'unknown':
      return <p>{PLAN_UNKNOWN_NOTICE}</p>;
  }
}

export function LaunchPlanNotice(props: LaunchPlanNoticeProps) {
  const { mode, locks, lockUnknown } = props.plan;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <PlanNotice {...props} />
      {lockUnknown && mode !== 'unknown' && <p>{PLAN_UNKNOWN_NOTICE}</p>}
      {locks.map(({ code, message }) => (
        <p key={code}>{message}</p>
      ))}
    </div>
  );
}
