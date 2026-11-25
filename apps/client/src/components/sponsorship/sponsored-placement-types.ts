// 区画の部品は、トップページ・ディレクトリ・プロダクト詳細ページの区画の文脈と構造的に互換な値だけを受け取る
export interface SponsoredPlacementProps {
  readonly viewer: { readonly signedIn: boolean };
}
