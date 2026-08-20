# Contributing

Working agreement for this repo during the WeMakeDevs "Into the Scrape-Verse"
hackathon (Aug 17-23, 2026). Applies to humans and to AI coding agents alike.

## The one rule

**Never push to `main`.** Branch, open a PR, merge the PR.

`main` only ever moves through a merged pull request. This holds for a one-line
docs fix, and it holds at 2am on deadline night.

## Why, when we are only two people

The PR is not a permission gate here (see self-merge below). It earns its keep
for three other reasons:

- The diff stays reviewable after the fact. Judges score clean code, and "every
  change landed through a PR" is evidence we can point at.
- `main` stays deployable. Root `docker-compose.prod.yml` is the Coolify
  deployment unit and auto-deploys on every push, so a broken `main` is a
  broken demo.
- Reverting one merge commit is cheap. Untangling a direct push is not.

## Workflow

```sh
git switch -c docs/kickoff-findings      # branch off main
# ... work ...
npm test                                 # from scrape-verse/, must be green
git push -u origin docs/kickoff-findings
gh pr create --fill
gh pr merge --squash --delete-branch
```

**Self-merge is allowed.** Do not sit blocked waiting on the other person if
they are asleep or heads-down. Merge your own PR once tests pass.

Use judgement on risky changes — deploy config, secrets handling, or the shared
output contract in `packages/shared` — and give the other person a heads-up
first. That is a courtesy, not a gate.

### Branch names

`area/short-summary`, using the same areas as commit messages:
`api/heal-orchestrator`, `web/price-chart`, `docs/prd-cut-order`,
`clone-store/layout-switch`.

### Commit messages

Lowercase `area: summary`, matching existing history:

```
backend: swap Hono/node-cron for NestJS + pg-boss
docs: ignore .obsidian vault state (per-machine UI files)
```

## Before you merge

- `npm test` passes from `scrape-verse/`. The validator tests must stay green —
  they are the spider-sense layer and they are pure and unit-testable on
  purpose.
- No secrets in the diff. `.env` is gitignored and stays that way.
- No emojis, anywhere: code, docs, output, commit messages.
- If the change touches the dashboard's mock data or the API contract, both
  move together. See AGENTS.md.

## Enforcement

A pre-push hook refuses pushes to `main`. **Every clone must opt in once:**

```sh
git config core.hooksPath .githooks
```

Run this right after cloning. The hook lives at `.githooks/pre-push` and is
version-controlled, so it stays in sync for both of us.

Escape hatch, for a genuine deadline emergency:

```sh
ALLOW_MAIN_PUSH=1 git push origin main
```

If you use it, say so in team chat — otherwise the other person hits a commit
on `main` with no PR behind it and has to go archaeology.

### The gap, stated plainly

GitHub-side branch protection is **not available on this repo**. It is private
on a Free plan, and both the rulesets and branch-protection APIs return 403
("Upgrade to GitHub Pro or make this repository public"). So the local hook is
the only enforcement that exists, and it only protects clones that ran the
`core.hooksPath` command above.

When the scrubbed public repo is split out for submission, real branch
protection becomes free — turn it on there.

## Related

- [AGENTS.md](./AGENTS.md) — instructions and hard rules for AI coding agents:
  secrets, the finite Bright Data credit budget, bounded scraper scope, no
  deploys without explicit go-ahead. Those rules bind humans too.
- [docs/](./docs/index.md) — hackathon brief, PRD, architecture, and the
  vendored Bright Data reference.
