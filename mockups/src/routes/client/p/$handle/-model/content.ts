// ユーザーが入力する内容を模した英語の仮テキスト。名称50文字・タグライン100文字・ニックネーム25文字はちょうど上限

export const LONG_NAME = 'Supercalifragilisticexpialidocious Analytics Suite';
export const LONG_TAGLINE =
  'Internationalization-ready observability for teams shipping hyperpersonalized onboarding experiences';

const LONG_URL =
  'https://docs.supercalifragilistic.example/guides/advanced-configuration/self-hosting/kubernetes/helm-chart-values-reference?utm_source=launchstadium&utm_medium=product-page&utm_campaign=autumn-relaunch-2026';

export function descriptionOf(name: string, long: boolean): string {
  if (!long) {
    return `${name} started as a weekend experiment and turned into the tool our whole team opens first thing every morning.

## What it does

- Connects to your existing stack in under five minutes
- Highlights what changed since your last visit, not everything at once
- Works offline and syncs when you're back

## Why we built it

We were tired of juggling three tabs and a spreadsheet just to answer a simple question. **${name}** answers it in one glance.

> "Finally, something that respects my attention." — an early beta tester

Pricing is simple: free for individuals, $6/month for teams. Read the [changelog](https://changelog.example) for what shipped this week.`;
  }
  return `# This line starts with a single hash, so it is shown as plain text

**${name}** is an end-to-end observability platform for product teams who care about *every* locale, every timezone and every edge case. It is the result of 3 years of Pneumonoultramicroscopicsilicovolcanoconiosis-level obsession with details nobody else wanted to look at.

## Table of contents

1. Getting started
2. Feature comparison
3. Configuration reference
   1. Environment variables
   2. Self-hosting on Kubernetes
4. Roadmap and known limitations

## Getting started

Install the CLI, authenticate, and point it at your staging environment:

\`\`\`sh
curl -fsSL https://install.supercalifragilistic.example/cli.sh | sh -s -- --channel=stable --telemetry=off --region=eu-central-1 --accept-license
supercali login --token "$SUPERCALI_TOKEN" && supercali init --framework=tanstack-start --with-edge-functions
\`\`\`

> **Heads-up:** the first sync can take a while on repositories with more than 10,000 translation keys.
>
> > Nested quote from our support team: "Grab a coffee, it is worth it."

### Feature comparison

| Feature | Free | Team | Enterprise |
| --- | --- | --- | --- |
| Locales | 3 | Unlimited | Unlimited |
| Pseudolocalization with configurable expansion ratio | — | ✓ | ✓ |
| Retention | 7 days | 90 days | Configurable, including indefinite retention for regulated industries |
| SSO (SAML / OIDC) | — | — | ✓ |

### Configuration reference

- \`SUPERCALI_REGION\` — one of \`us\`, \`eu\`, \`ap\`
- \`SUPERCALI_SAMPLE_RATE\` — between \`0\` and \`1\`
  - Values above \`0.5\` are only recommended for staging
  - ~~\`SUPERCALI_LEGACY_MODE\`~~ was removed in v3
- [x] Edge runtime support
- [ ] Native mobile SDKs (coming soon)

#### Self-hosting on Kubernetes

Full Helm values are documented here: ${LONG_URL}

![architecture diagram](https://cdn.supercalifragilistic.example/architecture.png)

## Roadmap and known limitations

We ship every Tuesday. Follow the [public roadmap](https://roadmap.supercalifragilistic.example) and tell us what to build next — every declined idea gets a "why not yet" note.`;
}

export const COMMENT_BODIES = [
  'Congrats on the win! 🎉 The onboarding flow is *so* smooth.',
  'Tried it on our staging project this morning. The diff view alone saved me twenty minutes.',
  'Two quick questions:\n\n1. Is there a public API?\n2. Can I self-host it behind our VPN?',
  'Love the attention to detail in the empty states.',
  'Does it support SSO via SAML? Our security team will ask before we can roll it out company-wide.',
  '🔥🔥🔥',
  'Small bug report: `Cmd+K` does not open the command palette when focus is inside the sidebar.',
  "> Works offline and syncs when you're back\n\nThis is the feature I didn't know I needed.",
  'Wrote a short review with screenshots here: https://blog.example/posts/first-impressions',
  'Honestly the best launch I have seen this week. Upvoted on day one and not disappointed.',
  'Antidisestablishmentarianism-level dedication to keyboard shortcuts. Respect.',
  'Would be great to have a dark mode for the embeddable widget.',
];

export const LONG_COMMENT_BODIES = [
  `## Detailed review after two weeks

I migrated **three** production projects and kept notes along the way.

### What worked

- Setup took less than 10 minutes per project
- The pseudolocalization preview caught 14 truncation bugs before QA did
- Support replied within an hour, even on a Sunday

### What did not

| Area | Issue | Severity |
| --- | --- | --- |
| Import | CSV files with BOM were rejected | Medium |
| Billing | Seat count did not update until the next day | Low |

\`\`\`ts
// The only workaround I needed for the CSV import:
const cleaned = raw.replace(/^\\uFEFF/, '').split('\\n').filter(Boolean).map((line) => line.trim());
\`\`\`

> Overall: would recommend, with the caveat that the CSV import still needs some love.

Full write-up: ${LONG_URL}`,
  `Pneumonoultramicroscopicsilicovolcanoconiosis aside, here is my feature wishlist:

1. Webhooks for every event type, including \`translation.approved\` and \`glossary.term.deprecated\`
2. A read-only API token scope so we can wire it into our internal dashboards
3. Bulk actions in the review queue — selecting 200 strings one by one is painful

> If any of these land, I will happily upgrade our whole organization.`,
];

export const REPLY_BODIES = [
  '+1, would love this too.',
  'Same here. Mention support in replies would also be nice.',
  'Thanks for the tip, that fixed it for me!',
  'Agreed. The keyboard shortcuts are the best part.',
];

export const MAKER_REPLIES = [
  'Thanks so much! 🙏 A public API is on the roadmap for next month.',
  'Great catch — fixed in v1.4.2, rolling out now.',
  'Thank you for the detailed feedback! The CSV import fix ships this Tuesday.',
];

export const OWN_COMMENT_BODY =
  'Been using this for a week. The weekly digest email is my favorite part — short, useful and actually readable on mobile.';

export const MAKER_UPDATE_BODY =
  'Thanks everyone for the support today! 🙌 We just shipped **offline mode** for all plans. Questions are very welcome below.';
