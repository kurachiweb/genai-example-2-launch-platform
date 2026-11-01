import type { MediaType } from '../../../common-lib/media/media-types.ts';
import type { MediaStorage } from './upload-purpose.ts';

export type MediaLocation = 'images' | 'files' | 'quarantine';

export type ModerationStatus =
  'not_required' | 'pending' | 'passed' | 'flagged' | 'undetermined';

export type QuarantineReason =
  'auto' | 'product_hidden' | 'user_suspended' | 'admin_action';

export const QUARANTINE_REASONS: readonly QuarantineReason[] = Object.freeze([
  'auto',
  'product_hidden',
  'user_suspended',
  'admin_action',
]);

// systemは動作確認の経路だけが使う主体で、利用者・管理者のどちらでもないため識別子を持たない
export type MediaOwner =
  | { readonly kind: 'user' | 'admin'; readonly id: string }
  | { readonly kind: 'system' };

// 検出内容はD1に残り管理画面に出るため、SVGのtargetには要素名・属性名だけを入れ、値を含めない
export type ModerationFinding =
  | {
      readonly source: 'labels';
      readonly category: string;
      readonly label: string;
      readonly confidence: number;
    }
  | {
      readonly source: 'svg';
      readonly violation: string;
      readonly target: string;
    }
  | {
      readonly source: 'unprocessable';
      readonly reason: 'undecodable' | 'rejected-by-service';
    };

export interface MediaFileView {
  readonly id: string;
  readonly objectKey: string;
  readonly purpose: string;
  readonly storage: MediaStorage;
  readonly location: MediaLocation;
  readonly owner: MediaOwner;
  readonly originalFileName: string;
  readonly contentType: MediaType;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly stored: boolean;
  readonly attached: boolean;
  readonly deletedAt: Date | null;
  readonly eraseRequested: boolean;
  readonly moderationStatus: ModerationStatus;
  readonly quarantineReasons: readonly QuarantineReason[];
  readonly quarantined: boolean;
  readonly createdAt: Date;
}

// ファイル用の用途は隔離の対象外で、画像用の用途は理由が1つでも残る間は隔離バケットに置く
export function desiredLocation(
  storage: MediaStorage,
  reasons: readonly QuarantineReason[],
): MediaLocation {
  if (storage === 'files') {
    return 'files';
  }
  return reasons.length > 0 ? 'quarantine' : 'images';
}
