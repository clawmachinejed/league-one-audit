# League One — SPEC-1.1.0 Bootstrap

Pinned: Node 20.x, pnpm 9, Next 15.0.0, React 18.3.1, TS 5.6.2, Zod 3.23.8, Tailwind 3.4.12, @vercel/og 0.6.2, ESLint 8.57.0 (+ eslint-config-next@15.0.0), Vitest 1.6.0, Playwright 1.47.2, Luxon 3.4.x.

Run:

```bash
corepack enable
corepack prepare pnpm@9 --activate
cp -n .env.example .env 2>/dev/null || true
pnpm install --frozen-lockfile
pnpm --filter @l1/site exec npx playwright install --with-deps
pnpm build
pnpm --filter @l1/site dev
```

[![verify](https://github.com/clawmachinejed/league-one-audit/actions/workflows/verify.yml/badge.svg)](https://github.com/clawmachinejed/league-one-audit/actions/workflows/verify.yml)
