## What and why

<!-- What does this change do, and why? Link the issue if there is one. -->

## How it was tested

<!-- Which commands you ran, and anything you checked by hand (for example in `pnpm run dev:fixture`). -->

## Checklist

- [ ] `NODE_OPTIONS=--max-old-space-size=4096 pnpm exec tsc --noEmit` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes (or I ran the suites near my change, listed above)
- [ ] `pnpm test:netlist` passes
- [ ] `pnpm e2e` passes (if the change touches the UI or a route)
- [ ] `pnpm exec tsx scripts/scan-secrets.ts` exits 0
- [ ] No `.env*` file, key, token, cookie, password or real provider response is included, in any commit of this branch
- [ ] No test, policy, CSRF check, role check or gate was weakened, and no timeout was raised, to make a check pass
- [ ] KiCad library files are unchanged, or any added or changed one keeps its CC-BY-SA-4.0 attribution and is recorded in `THIRD_PARTY_NOTICES.md`
- [ ] Any new third-party material is credited in `THIRD_PARTY_NOTICES.md`
- [ ] I agree that this contribution is licensed under the project's licence (MIT, see `LICENSE`), and I have the right to submit it
