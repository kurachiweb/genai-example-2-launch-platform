// ユーザーが入力する内容を模した仮のテキスト。上限に近い長さは文言規則の文字数上限(書記素数)に合わせる

export type ExternalLink = {
  // 名前は任意。空ならホスト名を表示する
  name: string;
  url: string;
};

// ニックネームの上限25文字ちょうどで、区切りの無い長い英単語
export const LONG_NICKNAME = 'Hubertwolfeschlegelsteinh';

export const HEADLINE = 'Indie maker shipping calm tools for small teams';
// ヘッドラインの上限50文字ちょうど
export const LONG_HEADLINE =
  'Hyperproductivity-skeptical maker of quiet tooling';

export const BIO = `Hi! I build small, calm tools for teams that are tired of noisy software. Most of my launches start as a weekend experiment and survive only if people keep using them.

- Currently shipping **Fieldnote** and **Offside Alerts**
- Writing about indie launches on [my blog](https://blog.jaw.example/posts)
- Sunday-league goalkeeper, weekday product engineer ⚽

Feedback is always welcome. The quickest way to reach me is a comment on any of my launches.`;

// 自己紹介の上限5,000文字に近い長さ。見出し・リスト・表・コードブロック・引用・リンク、長い英単語と長いURLを含める
export const LONG_BIO = `## About me

I am a product engineer turned solo maker. For the last nine years I have been building developer tooling, accessibility auditors and, occasionally, things nobody asked for. I care deeply about software that respects people's attention, and I believe the best interface is the one you can forget about once your task is done.

Before going independent I worked on internationalization infrastructure, which is a polite way of saying I spent three years debugging why a German compound noun like Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft broke every single layout we had.

### What I am working on

1. **Fieldnote** — field research notes that sync with your lab notebook
2. **Offside Alerts** — price drop alerts for indie SaaS
3. **Lanternfish** — a deep-sea inspired dark mode generator
4. A secret project involving Pneumonoultramicroscopicsilicovolcanoconiosis-level naming problems

### How I launch

- I launch early, usually on a Tuesday, because Mondays are for fixing what broke over the weekend
- If a launch loses its qualifier match, I read every comment, ship the top three fixes and relaunch a week later
- I never ask for upvotes in private groups; I would rather lose fairly than win quietly
- I publish every postmortem, including the embarrassing ones

| Product | Launches | Best result |
| --- | --- | --- |
| Offside Alerts | 5 | Product of the Week ×2 |
| Lanternfish | 2 | Product of the Year |
| Fieldnote | 2 | Product of the Week |
| Telemetry Lens | 1 | Week quarter-final |

### Tooling I rely on

\`\`\`ts
// The tiny helper I copy into every single project
export function formatRelativeDays(from: Date, to: Date): string {
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return days === 0 ? 'today' : days > 0 ? \`in \${days} days\` : \`\${-days} days ago\`;
}
\`\`\`

> Ship the smallest thing that could possibly be useful, then listen harder than you talk.
>
> — a sticky note that has survived four apartment moves

### Writing and talks

I write a monthly newsletter about launching small products without burning out. Some of the most-read issues:

- [Why I relaunch instead of rewriting](https://blog.jaw.example/posts/why-i-relaunch-instead-of-rewriting)
- [The accessibility checklist I actually use](https://blog.jaw.example/posts/accessibility-checklist)
- [Pricing experiments that failed spectacularly](https://blog.jaw.example/posts/pricing-experiments)

My conference talk slides are archived here, including the full transcript and every audience question: https://talks.jaw.example/archive/2026/international-accessibility-and-localization-summit/slides-with-speaker-notes-and-transcripts?format=accessible-html&include=audience-questions

### Things I am bad at

Naming things. Estimating anything. Remembering to eat lunch on launch day. Saying no to interesting side projects. Writing short bios, apparently.

### Things I am good at

Turning vague complaints into small, testable improvements. Reading error logs at 3 a.m. without panicking. Making coffee for people who are reading error logs at 3 a.m. and panicking.

### Collaborations

I am open to collaborations with makers who care about accessibility, localization or developer experience. I especially enjoy pairing on the unglamorous parts of a product: onboarding emails, empty states, error messages and the settings page nobody wants to own. If that sounds like your kind of thing, leave a comment on one of my launches and tell me what you are building.

### Frequently asked questions

**Do you take on freelance work?** Rarely, and only for teams building tools for teachers, nurses or other people who are already overworked.

**Why football?** Because a match lasts ninety minutes, both teams get the same pitch, and the result is final. Launch days should feel like that too: honest, a little nerve-racking and over by dinner time.

**Can I use your icon sets commercially?** Yes. Attribution is appreciated but not required.

### Acknowledgements

Thanks to everyone who upvoted my early launches when they were still rough around the edges, to the people who left brutally honest comments, and to the opponent who beat Lanternfish in its first qualifier by exactly one upvote. I relaunched a week later with a better onboarding flow, and that loss is the reason it eventually became Product of the Year.

### Elsewhere

You can also find me on the links below. I reply to most messages within a week, faster if you include a screenshot. Please do not send me Antidisestablishmentarianism-themed puns; I have heard all of them, twice, and I still laugh every time, which is the actual problem.`;

export const LINKS: ExternalLink[] = [
  { name: 'GitHub', url: 'https://github.example/jaw' },
  { name: 'Engineering Blog', url: 'https://blog.jaw.example/posts' },
  { name: 'X', url: 'https://x.example/jaw' },
  { name: '', url: 'https://portfolio.example/' },
  {
    name: 'Newsletter',
    url: 'https://newsletter.example/subscribe?ref=profile',
  },
];

// 名前の上限25文字に近い長さと、長いホスト名・URL
export const LONG_LINKS: ExternalLink[] = [
  { name: 'Accessibility Field Notes', url: 'https://a11y-notes.example/' },
  {
    name: 'Supercalifragilisticexpia',
    url: 'https://supercalifragilisticexpialidocious.example/',
  },
  {
    name: 'Open Source Contributions',
    url: 'https://github.example/jaw?tab=repositories&type=source&language=typescript&sort=stargazers',
  },
  {
    name: '',
    url: 'https://documentation.internationalization-consortium.example/working-groups/accessibility/minutes/2026-09-30?highlight=screen-reader-compatibility',
  },
  {
    name: 'Conference Talks Archive',
    url: 'https://talks.jaw.example/archive/2026/international-accessibility-and-localization-summit',
  },
];

// プロダクト名称の上限50文字・タグラインの上限100文字に近い長さ
export const LONG_PRODUCT_TEXTS: { name: string; tagline: string }[] = [
  {
    name: 'Comprehensive Accessibility Remediation Workbench',
    tagline:
      'Audit, prioritize and fix contrast, focus order and screen reader issues across every page you ship',
  },
  {
    name: 'Electroencephalographically-Tuned Focus Playlists',
    tagline:
      'Adaptive soundscapes tuned to your focus level, built with neuroscientists, composers and tired devs',
  },
  {
    name: 'Internationalization Readiness Scanners for Indies',
    tagline:
      'Find hard-coded strings, concatenated sentences and locale-unsafe date formats before you launch',
  },
];
