export type ArtVariant =
  'orbit' | 'stripes' | 'blob' | 'grid' | 'bolt' | 'wave' | 'ring' | 'peak';

export type Product = {
  id: string;
  name: string;
  tagline: string;
  category: string;
  handle: string;
  siteUrl: string;
  art: { palette: number; variant: ArtVariant };
};

export type User = {
  id: string;
  nickname: string;
  handle: string;
  // プロフィール画像が未設定ならnull
  art: { palette: number } | null;
};

export const CATEGORIES = [
  'AI',
  '開発ツール',
  'マーケティング',
  '生産性',
  'デザイン',
  '教育',
  'ヘルスケア',
  'その他',
] as const;

const VARIANTS: ArtVariant[] = [
  'orbit',
  'stripes',
  'blob',
  'grid',
  'bolt',
  'wave',
  'ring',
  'peak',
];

// 名称は50文字以内、タグラインは100文字以内。短文・長文・長い英単語を織り交ぜる
const PRODUCT_SEEDS: [string, string, (typeof CATEGORIES)[number]][] = [
  ['Pitch Notes', 'Match analysis for grassroots football coaches', '生産性'],
  [
    'Tactics Board',
    'Draw, animate and share set pieces with your squad in seconds',
    '生産性',
  ],
  [
    'Quill',
    'An uncompromisingly minimalist markdown editor for people who think in outlines',
    '生産性',
  ],
  [
    'Hyperlocalization Studio',
    'Continuous localization pipelines with pseudolocalization, screenshot diffing and glossary enforcement',
    '開発ツール',
  ],
  ['Kanban Otter', 'Boards that swim with you', '生産性'],
  [
    'Sentinel Deploy',
    'Zero-downtime rollouts for edge workers, with automatic rollback when p95 latency regresses',
    '開発ツール',
  ],
  [
    'Bloomwatch',
    'Photosynthesis-aware irrigation schedules for indoor gardens',
    'その他',
  ],
  [
    'Mnemonic',
    'Spaced repetition flashcards generated from any PDF, lecture recording or GitHub README',
    '教育',
  ],
  ['Cadence', 'Meeting notes that write themselves', 'AI'],
  [
    'Interoperability Gateway for Municipal Open Data',
    'One GraphQL endpoint over 340 city datasets, normalized, versioned and cached at the edge',
    '開発ツール',
  ],
  [
    'Glyphforge',
    'Variable font sandbox with live OpenType feature toggles and a WOFF2 subsetter',
    'デザイン',
  ],
  ['Nightwatch', 'Sleep coaching from your existing wearable', 'ヘルスケア'],
  [
    'Bento Screenshots',
    'Turn boring screenshots into pretty, sharable bento layouts. No design skills required.',
    'デザイン',
  ],
  [
    'Vellum Reader',
    'A distraction-free reader with electrochromic-inspired themes',
    'その他',
  ],
  [
    'Postmortem.dev',
    'Blameless incident retrospectives with timeline reconstruction from Slack, PagerDuty and GitHub',
    '開発ツール',
  ],
  ['Ledgerly', 'Bookkeeping for indie hackers', 'その他'],
  [
    'Spectrogram',
    'Audio fingerprinting API with sub-second lookup across 40 million tracks',
    'AI',
  ],
  [
    'CopyPilot',
    'Landing page copy that converts, drafted in your brand voice and A/B tested automatically',
    'マーケティング',
  ],
  [
    'Attribution Compass',
    'Multi-touch attribution without the spreadsheet purgatory',
    'マーケティング',
  ],
  [
    'Photogrammetry Kit',
    'Reconstruct 3D models from a handful of phone photos, entirely in the browser via WebGPU',
    'AI',
  ],
  ['Habitat', 'Tiny habits, big streaks', 'ヘルスケア'],
  [
    'Syllabus Studio',
    'Build accredited course outlines with learning objectives mapped to Bloom’s taxonomy',
    '教育',
  ],
  [
    'Tidewatch Analytics',
    'Privacy-first web analytics you can explain to your grandmother',
    'マーケティング',
  ],
  ['Ferrous', 'Rust-powered image CDN in a single binary', '開発ツール'],
  [
    'Whiteboard Weather',
    'Collaborative whiteboards that fade old ideas like weather patterns, keeping the fresh ones vivid',
    'デザイン',
  ],
  [
    'Nutrilog',
    'Log meals by photo, get macro estimates verified by a registered dietitian',
    'ヘルスケア',
  ],
  [
    'Stackline',
    'Diff your infrastructure like you diff your code',
    '開発ツール',
  ],
  [
    'Conversational Onboarding Orchestrator',
    'Replace 14-step signup wizards with a single chat that fills every field for the user',
    'AI',
  ],
  ['Praxis', 'Deliberate practice planner for musicians', '教育'],
  [
    'Marginalia',
    'Annotate any web page, sync highlights to Obsidian, Notion and plain text folders',
    '生産性',
  ],
  [
    'Snapdragon Forms',
    'Forms with conditional logic that finally feel like a conversation',
    'マーケティング',
  ],
  ['Orbital', 'Satellite pass predictions for rooftop antennas', 'その他'],
  [
    'Chromatic Accessibility Auditor',
    'Contrast, focus order and screen reader checks running on every pull request',
    'デザイン',
  ],
  ['Kettle', 'Brew timers for pour-over perfectionists', 'その他'],
  [
    'Rehearsal Room',
    'Practice presentations against an AI audience that interrupts, questions and gets bored',
    'AI',
  ],
  [
    'Chartwell',
    'Charts for financial reports that pass the “printed in black and white” test',
    'デザイン',
  ],
  [
    'Triage Inbox',
    'Customer support inbox that groups tickets by root cause instead of arrival time',
    '生産性',
  ],
  [
    'Polyglot Pronunciation Coach',
    'Phoneme-level feedback for 27 languages, using only your laptop microphone',
    '教育',
  ],
  ['Beacon', 'Status pages people actually read', '開発ツール'],
  [
    'Hydrate',
    'Water intake reminders that adapt to weather, workouts and caffeine',
    'ヘルスケア',
  ],
  [
    'Northstar Roadmaps',
    'Public roadmaps with voting, changelogs and a “why not yet” section for every declined idea',
    'マーケティング',
  ],
  ['Loom & Latch', 'Pattern generator for hand weavers', 'その他'],
];

function toHandle(name: string) {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const PRODUCTS: Product[] = PRODUCT_SEEDS.map(
  ([name, tagline, category], index) => ({
    id: `prd-${String(index + 1).padStart(3, '0')}`,
    name,
    tagline,
    category,
    handle: toHandle(name),
    siteUrl: `https://${toHandle(name).replace(/-/g, '')}.example`,
    art: {
      palette: (index * 7) % 12,
      variant: VARIANTS[(index * 3) % VARIANTS.length],
    },
  }),
);

// ニックネームは25文字以内。短い名前・長い名前・区切りの無い長い英単語を織り交ぜ、一部はプロフィール画像を未設定にする
const USER_SEEDS: [string, string, boolean][] = [
  ['Kurachi', 'KurachiWeb', true],
  ['maker_ai', 'maker_ai', true],
  ['Josephine Abernathy-Smith', 'jaw', true],
  ['Yu', 'yu', false],
  ['Tobias', 'tobias_builds', true],
  ['Priya Raman', 'priya_ships', true],
  ['Mateo', 'mateo-dev', false],
  ['Hubertwolfeschlegelsteinh', 'hubert', true],
  ['Ada', 'ada_l', true],
  ['Noah Fitzgerald', 'noahfitz', false],
  ['Lin', 'lin_codes', true],
  ['Oluwaseun Adeyemi', 'seun', true],
  ['Freya', 'freya_makes', false],
  ['Sasha K.', 'sashak', true],
  ['indie_hacker_42', 'indie_hacker_42', true],
  ['Grace Hopperfan', 'gracefan', false],
  ['Kenji', 'kenji_t', true],
  ['Amélie Durand', 'amelie', true],
  ['Rohan', 'rohan_builds', false],
  ['Zoë', 'zoe', true],
];

export const USERS: User[] = USER_SEEDS.map(
  ([nickname, handle, hasImage], index) => ({
    id: `usr-${index + 1}`,
    nickname,
    handle,
    art: hasImage ? { palette: (index * 5 + 2) % 12 } : null,
  }),
);

export const CURRENT_USER = USERS[0];

export function productAt(index: number): Product {
  return PRODUCTS[index % PRODUCTS.length];
}
