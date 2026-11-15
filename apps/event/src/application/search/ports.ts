// 元データの本文・キーワード・外部APIのキーはエラートラッキングへ送らないため、通知の型に持たせない
export type SearchIncident =
  | { readonly kind: 'unregistered-target'; readonly target: string }
  | {
      readonly kind: 'extractor-misconfigured';
      readonly target: string;
      readonly status: number;
    };

export interface SearchIncidentReporter {
  report(incident: SearchIncident): void;
}
