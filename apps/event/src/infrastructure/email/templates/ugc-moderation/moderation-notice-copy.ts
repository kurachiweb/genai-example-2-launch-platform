export const CONTACT_ACTION_LABEL = 'お問い合わせ';

export const USER_SUSPENDED_LEAD =
  '運営者の判断により、あなたのアカウントを停止しました。';

export function productHiddenLead(productName: string): string {
  return `運営者の判断により、${productName}の公開を停止しました。`;
}

export function commentHiddenLead(productName: string): string {
  return `運営者の判断により、${productName}へのあなたのコメントの公開を停止しました。`;
}

// スポンサー広告の機能が文言規則へ載せる段落と一字一句同じにする
export const USER_SUSPENDED_SPONSORSHIP_PARAGRAPH =
  '停止中は、あなたのスポンサー広告は表示されません。掲載期間は延長されませんが、表示を停止した日数分(1日のうち一部でも停止した日を含みます)の広告料金を、各広告の掲載期間が終わった時点で日割りにより自動で返金します。掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。';

export const PRODUCT_HIDDEN_SPONSORSHIP_PARAGRAPH =
  'このプロダクトのスポンサー広告は、公開を停止している間は表示されません。掲載期間は延長されませんが、表示を停止した日数分(1日のうち一部でも停止した日を含みます)の広告料金を、広告の掲載期間が終わった時点で日割りにより自動で返金します。掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。';
