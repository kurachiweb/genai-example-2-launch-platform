// ペアリング済みは予定と同じ「キックオフ予定」、終了は予選の結果(won・lost)で文言を選ぶ
export const LAUNCH_STATUS_LABELS = Object.freeze({
  scheduled: 'キックオフ予定',
  in_progress: '予選マッチ中',
  won: 'ディレクトリ掲載',
  lost: '予選敗北',
  canceled: '取消',
} as const);

export const KICKOFF_PREFIX = 'キックオフ: ';

export const LAUNCH_DATE_PREFIX = 'ローンチ日: ';

export const RELEASE_PREFIX = '解除: ';

export const WATCH_ON_TOP_LABEL = 'トップページで見る';

export const RESERVE_NEXT_LAUNCH_LABEL = '次回のローンチを予約';

export const RESCHEDULE_NOTICE = 'ローンチ日は編集画面で変更できます。';

export const PLAN_UNKNOWN_NOTICE = 'ローンチの状態を確認できませんでした。';

export const EARLIEST_LAUNCH_DATE_NOTICE = Object.freeze({
  before: 'このプロダクトは',
  after: '以降のローンチ日を選べます。',
});

// ローンチ日のカレンダーの選べない日の理由。状態の表示のため句点を付けず、ツールチップと読み上げ用の文言に同じ文言を使う
export const UNAVAILABLE_LAUNCH_DATE_REASONS = Object.freeze({
  pairing_deadline: 'ペアリングの締め切りを過ぎています',
  relaunch_interval: '敗北後の間隔のため選べません',
  out_of_range: '選べる期間の外です',
} as const);

// 敗北後の日数はapps/apiのsrc/domain/product/launch-date-rules.tsのENTITLED_RELAUNCH_INTERVAL_DAYSの写しで、一致はルートのconfig/product-contract-copies.unit.test.tsが確かめる
export const ULTRAS_RELAUNCH_PROMOTION =
  'Ultrasなら敗北後2日で再ローンチできます。';

export const PRICING_LINK_LABEL = '料金を見る';

export const RESERVE_LAUNCH_LABEL = 'ローンチを予約🚀';

export const RESERVE_LAUNCH_GUEST_LABEL = 'ログインしてローンチを予約🚀';
