const HELP_LINKS = [
  'ヘルプ',
  'Launch Stadiumの仕組み',
  'Weekトーナメントの参加方法',
  'Upvoteのルール',
];

const LEGAL_LINKS = ['利用規約', 'プライバシーポリシー', '法的通知', '料金'];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-card/60">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
        <div>
          <p className="text-base font-extrabold tracking-tight">
            Launch Stadium
          </p>
          <p className="mt-2 max-w-xs text-muted-foreground">
            1対1のマッチで競うローンチプラットフォーム。必ず半分は勝者になります。
          </p>
        </div>
        <nav aria-label="ヘルプ">
          <p className="font-semibold">ヘルプ</p>
          <ul className="mt-2 space-y-1.5">
            {HELP_LINKS.map((label) => (
              <li key={label}>
                <a
                  href="#"
                  className="text-muted-foreground hover:text-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="規約・問い合わせ">
          <p className="font-semibold">規約・問い合わせ</p>
          <ul className="mt-2 space-y-1.5">
            {LEGAL_LINKS.map((label) => (
              <li key={label}>
                <a
                  href="#"
                  className="text-muted-foreground hover:text-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#"
                className="text-muted-foreground hover:text-foreground"
              >
                お問い合わせ
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
