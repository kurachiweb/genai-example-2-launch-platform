import {
  ADMIN_NICKNAME_MAX,
  ADMIN_TITLE_MAX,
} from '../../../common-lib/admin/admin-input-rules.ts';
import type { AdminAccountStatus } from '../../graphql/admin-accounts.ts';

export const ADMIN_ACCOUNTS_TITLE = '管理者アカウント';

export const ADMIN_ACCOUNTS_DESCRIPTION =
  '管理者の招待と、最上位管理者以外の管理者の削除はモデレーター以上が行えます。最上位管理者の削除・ロールの変更・他の管理者のプロフィールの編集は最上位管理者が行えます。自分のプロフィールは自分のアカウントのページで編集します。';

export const ADMIN_LIST_HEADING = '管理者の一覧';

export const ADMIN_LIST_EMPTY_MESSAGE = '管理者はまだいません。';

export const ADMIN_LIST_COLUMNS = Object.freeze({
  avatar: '画像',
  nickname: 'ニックネーム',
  title: '肩書き',
  email: 'メールアドレス',
  role: 'ロール',
  status: '状態',
  createdAt: '登録日時',
  actions: '操作',
});

export const NOT_SET_LABEL = '未設定';

export const SELF_LABEL = '自分';

export const ADMIN_STATUS_LABELS: Readonly<Record<AdminAccountStatus, string>> =
  Object.freeze({
    active: '有効',
    invited: '招待中',
    invitation_expired: '招待期限切れ',
  });

export const INVITE_ADMIN_LABEL = '管理者を招待';

export const INVITE_ADMIN_DESCRIPTION =
  '招待した管理者は閲覧のみのロールで登録されます。招待のリンクの有効期限は24時間です。';

export const INVITE_ADMIN_SUBMIT_LABEL = '招待する';

export const invitationSentMessage = (email: string): string =>
  `${email}に招待のメールを送信しました。`;

export const RESEND_INVITATION_LABEL = '招待を再送';

export const RESEND_INVITATION_DESCRIPTION =
  '未使用の招待のリンクを無効にし、新しい招待のリンクを送信します。リンクの有効期限は24時間です。';

export const RESEND_INVITATION_CONFIRM_LABEL = '再送する';

export const INVITATION_RESENT_MESSAGE = '招待を再送しました。';

export const resendInvitationTitle = (target: string): string =>
  `「${target}」に招待を再送しますか?`;

export const DELETE_ADMIN_LABEL = '削除';

export const DELETE_ACTIVE_ADMIN_DESCRIPTION =
  '削除した管理者はログインできなくなります。削除は元に戻せません。';

export const DELETE_INVITED_ADMIN_DESCRIPTION =
  '招待を取り消し、招待のリンクを無効にします。';

export const DELETE_ADMIN_CONFIRM_LABEL = '削除する';

export const ADMIN_DELETED_MESSAGE = '管理者を削除しました。';

export const deleteAdminTitle = (target: string): string =>
  `管理者「${target}」を削除しますか?`;

export const CHANGE_ROLE_LABEL = 'ロールを変更';

export const NEW_ROLE_LABEL = '変更後のロール(必須)';

export const NEW_ROLE_REQUIRED_MESSAGE = '変更後のロールを選んでください。';

export const CHANGE_ROLE_SUBMIT_LABEL = '変更する';

export const ROLE_CHANGED_MESSAGE = 'ロールを変更しました。';

export const changeRoleTitle = (target: string): string =>
  `「${target}」のロールを変更`;

export const currentRoleText = (roleLabel: string): string =>
  `現在のロール: ${roleLabel}`;

export const EDIT_PROFILE_LABEL = 'プロフィールを編集';

export const NICKNAME_LABEL = 'ニックネーム(必須)';

export const NICKNAME_DESCRIPTION = `${String(ADMIN_NICKNAME_MAX)}文字以内で入力してください。`;

export const ADMIN_TITLE_LABEL = '肩書き(任意)';

export const ADMIN_TITLE_DESCRIPTION = `${String(ADMIN_TITLE_MAX)}文字以内で入力してください。`;

export const ADMIN_TITLE_TOO_LONG_MESSAGE = `肩書きは${String(ADMIN_TITLE_MAX)}文字以内で入力してください。`;

export const AVATAR_LABEL = 'プロフィール画像(任意)';

export const AVATAR_DESCRIPTION =
  'JPEG・PNG・GIF・WebP・SVGの500KB以内の画像を登録できます。';

export const AVATAR_SELECT_LABEL = '画像を選択';

export const AVATAR_SUBJECT_LABEL = 'プロフィール画像';

export const AVATAR_REMOVE_LABEL = '画像を取り除く';

export const AVATAR_REMOVED_NOTICE =
  '画像を登録しない間は、ニックネームから作るアイコンを表示します。';

export const PROFILE_SUBMIT_LABEL = '保存する';

export const PROFILE_SAVED_MESSAGE = 'プロフィールを保存しました。';

export const editProfileTitle = (target: string): string =>
  `「${target}」のプロフィールを編集`;

// 行ごとに並ぶ同じ名前の操作を支援技術で区別するため、操作の名前に対象の管理者を含める
export const ROW_ACTION_NAMES = Object.freeze({
  resend: (target: string) => `「${target}」の${RESEND_INVITATION_LABEL}`,
  changeRole: (target: string) => `「${target}」の${CHANGE_ROLE_LABEL}`,
  editProfile: (target: string) => `「${target}」の${EDIT_PROFILE_LABEL}`,
  delete: (target: string) => `「${target}」を${DELETE_ADMIN_LABEL}`,
});
