interface CoverageBase {
  readonly order: number;
  readonly name: string;
}

export type DailyBatchJobCoverage =
  | (CoverageBase & {
      readonly kind: 'targets';
      readonly tables: readonly string[];
    })
  | (CoverageBase & { readonly kind: 'excluded'; readonly reason: string })
  | (CoverageBase & {
      readonly kind: 'no-rows-needed';
      readonly reason: string;
    });

const EXTERNAL_API =
  '外部APIを呼ぶため、stagingで実在しない合成データへの呼び出しを避ける';

const MAIL =
  'メール送信を依頼し、stagingで`.example`の宛先への送信の拒否を大量に起こすため対象外にする';

const SYNTHETIC_PURGE =
  '後続処理が合成データそのものをQueue経由で物理削除し、0:00から計測までの間に合成データが消えるため対象外にする';

const targets = (
  order: number,
  name: string,
  ...tables: string[]
): DailyBatchJobCoverage => ({ order, name, kind: 'targets', tables });

const excluded = (
  order: number,
  name: string,
  reason: string,
): DailyBatchJobCoverage => ({ order, name, kind: 'excluded', reason });

// 日次タイムラインの4:21の表の全ジョブについて、合成データが対象の行を作るか、作らない理由は何かを、表の順序のとおりに持つ。計測の結果で処理の件数が0のジョブが、対象が空なのか不具合なのかを見分ける材料にする
export const DAILY_BATCH_JOB_COVERAGE: readonly DailyBatchJobCoverage[] =
  Object.freeze([
    excluded(100, 'identity-auth.purge-orchestrator', SYNTHETIC_PURGE),
    targets(
      110,
      'identity-auth.credential-cleanup',
      'user_sessions',
      'user_auth_tokens',
      'user_login_challenges',
      'user_totp_credentials',
    ),
    excluded(
      120,
      'identity-auth.disposable-recheck-sweep',
      `使い捨てメールアドレスの再判定を依頼し、${EXTERNAL_API}`,
    ),
    targets(
      200,
      'admin-foundation.credential-cleanup',
      'admin_sessions',
      'admin_auth_tokens',
      'admin_login_challenges',
      'admin_totp_credentials',
    ),
    targets(
      210,
      'admin-foundation.audit-log-retention',
      'admin_audit_logs',
      'admin_audit_log_targets',
    ),
    targets(300, 'inquiry-chat.guest-inquiry-retention', 'guest_inquiries'),
    excluded(
      400,
      'payments.pending-checkout-sweep',
      `Stripeの状態と突合し、${EXTERNAL_API}`,
    ),
    targets(410, 'payments.history-retention', 'payment_records'),
    targets(
      500,
      'ultras-subscription.pending-dispatch-sweep',
      'ultras_notices',
    ),
    targets(600, 'user-profile-social.orphaned-file-sweep', 'media_files'),
    targets(810, 'media-pipeline.expired-file-erasure', 'media_files'),
    targets(820, 'media-pipeline.moderation-requeue', 'media_files'),
    targets(
      830,
      'media-pipeline.location-reconciliation',
      'media_files',
      'media_file_quarantine_reasons',
    ),
    targets(
      900,
      'email-delivery.cleanup',
      'email_send_records',
      'email_suppressions',
    ),
    excluded(1000, 'product-launch.purge-orchestrator', SYNTHETIC_PURGE),
    excluded(
      1010,
      'product-launch.lifecycle-redispatch',
      `送り直した後続処理が合成のプロダクトを削除・非公開化する。${SYNTHETIC_PURGE}`,
    ),
    targets(1100, 'match-engine.event-redispatch', 'match_events'),
    targets(
      1110,
      'match-engine.event-cleanup',
      'match_events',
      'match_event_handler_runs',
    ),
    excluded(1300, 'notifications.maintenance', MAIL),
    targets(1400, 'engagement.comment-anonymization', 'launch_comments'),
    excluded(
      1500,
      'tournament-week.entry-follow-up',
      `返金をStripeへ依頼し、${EXTERNAL_API}`,
    ),
    targets(
      1600,
      'sponsorship.maintenance',
      'sponsorships',
      'sponsorship_display_stops',
    ),
    excluded(
      1700,
      'tournament-year.entry-follow-up',
      `返金をStripeへ依頼し、${EXTERNAL_API}`,
    ),
    {
      order: 1900,
      name: 'ugc-moderation.weekly-statistics',
      kind: 'no-rows-needed',
      reason:
        '直近26週のうち確定していない週(行の無い週を含む)を全て集計するため、集計の表に行が無い状態が最大の仕事量になり、集計の元になる利用者・プロダクト・マッチ・Upvoteの合成データが負荷を決める',
    },
    targets(1910, 'ugc-moderation.maintenance', 'moderation_actions'),
    excluded(2000, 'content-reporting.notice-redispatch', MAIL),
    targets(
      2010,
      'content-reporting.report-retention',
      'report_cases',
      'reports',
    ),
    targets(2100, 'data-export.archive-expiry', 'data_exports'),
    excluded(
      2110,
      'data-export.generation-recovery',
      `滞った作成中の要求を失敗として確定するたび(1回の起動で最大1,000件)に、失敗のメールの依頼とエラートラッキングへのwarningを起こす。${MAIL}。エラートラッキングへの大量のwarningも避ける`,
    ),
    targets(
      2300,
      'content-processing.keyword-reextraction',
      'help_article_search_documents',
    ),
  ]);
