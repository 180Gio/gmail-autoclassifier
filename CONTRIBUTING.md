# Contributing

Thanks for your interest in Gmail AutoClassifier! This project is local-first and
provider-agnostic; contributions of all sizes are welcome, especially new AI
providers.

## Getting started

```bash
npm install
cp .env.example .env   # optional: everything can be set from the UI
npm run dev            # API on :8787, UI on :5173
```

You will need your own Google OAuth credentials (Gmail API enabled) and an AI
provider. The offline `mock` provider lets you exercise the whole flow without
any external service.

## Before opening a pull request

Run all three locally:

```bash
npm run typecheck
npm test
npm run build
```

The same checks run in GitHub Actions on every push and pull request.

## Adding an AI provider

1. Create `src/server/ai/providers/my-provider.ts` implementing `AiProvider`
   (see `src/server/ai/types.ts`).
2. Register it in `src/server/ai/index.ts`.
3. Add its id to the `AiProviderId` union in `src/shared/types.ts`.
4. Declare its settings in `SETTING_DEFINITIONS` in `src/server/settings.ts` —
   they appear automatically in the Settings UI.
5. Document it in the README (AI providers section).
6. Add a unit test for any pure logic you introduce.

Read configuration through `getSetting(...)`; never hard-code secrets. The
`mock` provider is a good template for offline tests.

## Code style

- TypeScript strict mode; `npm run typecheck` must pass.
- Keep provider/Gmail logic server-side; the browser must never see tokens.
- Prefer small pure functions for logic that can be tested (see
  `planFilters`, `parseFilterSenders`, `parseClassificationResponse`).
- Match the existing formatting and naming conventions.
- UI text and documentation are in English.

## Security

- **Never commit** `.env`, `data/`, tokens, API keys or personal email data.
- Secrets are encrypted at rest with `SESSION_SECRET`; do not log them.
- Gmail scopes are sensitive/restricted. Keep OAuth apps in Testing mode for
  personal use; public distribution requires Google verification.

## Pull requests

- Keep PRs focused; describe the problem and the approach.
- Link related issues (`Closes #12`).
- Update the README if behavior or configuration changes.
- Fill in the pull request template checklist.

## Reporting bugs

Use the issue templates. Include OS, Node version, AI provider, steps to
reproduce, and redacted logs. Never paste secrets or full email contents.

## License

By contributing you agree that your contributions are licensed under the MIT
License (see [LICENSE](./LICENSE)).
