type Props = {
  count: number;
  // フォロワー一覧は本人の設定ページ(`/settings/follows`)でのみ閲覧できるため、本人にだけリンクにする
  linked: boolean;
};

export function FollowerCount({ count, linked }: Props) {
  const content = (
    <>
      <span className="text-sm text-muted-foreground">フォロワー</span>
      <span className="scoreboard-digits text-xl leading-none">
        {count.toLocaleString()}
        <span className="ml-0.5 text-sm font-bold">人</span>
      </span>
    </>
  );

  if (!linked) {
    return <p className="flex items-baseline gap-1.5">{content}</p>;
  }
  return (
    <a
      href="#"
      className="flex items-baseline gap-1.5 rounded-md text-foreground no-underline hover:underline"
      title="フォロワー一覧を設定ページで見る"
    >
      {content}
    </a>
  );
}
