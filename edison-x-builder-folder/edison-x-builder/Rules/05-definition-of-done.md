# 05 - Definition of Done

## A task is done when
- The code is written and follows `04-code-quality.md`.
- Tests exist for the behavior, and they pass on a clean checkout.
- Lint, type-check, and the full test suite pass.
- Any new setting is in `.env.example` and `config.ts`.
- Any new source or capability is reflected in `docs/SOURCES.md`.
- Docs touched by the change are updated.

## A phase is done when
- Every acceptance criterion in `Guidelines.md` section 13 for that phase is proven by a test or a recorded manual run.
- You ran the proof yourself and pasted real results into the phase report.
- No `TODO`, skipped test, or known failure is hidden. Each one is listed in "Deviations".
- A Rules check was done and recorded.

## The project is done when
- All phases are PASSED.
- The full checklist in `Guidelines.md` section 16 is checked, each item with evidence.
- A second agent has connected with its own key and no code changes.
- A fresh clone reaches a working server by following the README.
- The final report states every deviation and open question honestly.

## What does not count as proof
- "It should work."
- Output from a different version of the code.
- A test that never fails (assert something that can actually go wrong).
- Manual testing that was not written down.
