# Fix the flaky login test

## Context
`auth.test.js` fails ~1 in 10 runs in CI. It's a timing race, not a real bug.

## Steps
1. Replace the fixed `setTimeout(50)` with an explicit `await waitForToken()`.
2. Remove the shared module-level `session` variable.
3. Re-run the test 100× locally to confirm it's stable.

## Verification
- `npm test -- auth.test.js --runs 100` passes every time.
