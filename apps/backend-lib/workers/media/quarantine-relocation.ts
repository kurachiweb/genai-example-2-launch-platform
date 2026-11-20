import {
  desiredLocation,
  type MediaFileView,
  type QuarantineReason,
} from '../../core/media/media-file.ts';

export type ReasonChange = 'add' | 'remove';

function reasonsAfter(
  file: MediaFileView,
  reason: QuarantineReason,
  change: ReasonChange,
): readonly QuarantineReason[] {
  const others = file.quarantineReasons.filter((each) => each !== reason);
  return change === 'add' ? [...others, reason] : others;
}

// 記録の保存先との食い違いも対象にするのは、送信の失敗の後の再実行で理由が変わらなくても移動を依頼し直すため。目的の保存先が変わる場合は、逆向きの移動の途中で記録の保存先が古いままのことがあるため対象にする
export function needsRelocation(
  file: MediaFileView,
  reason: QuarantineReason,
  change: ReasonChange,
): boolean {
  if (file.eraseRequested) {
    return false;
  }
  const before = desiredLocation(file.storage, file.quarantineReasons);
  const after = desiredLocation(
    file.storage,
    reasonsAfter(file, reason, change),
  );
  return before !== after || after !== file.location;
}
