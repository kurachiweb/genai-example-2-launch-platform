export interface RequestMeta {
  readonly clientIp: string | undefined;
  // 512文字までに切ったもの
  readonly userAgent: string | undefined;
  readonly now: Date;
}
