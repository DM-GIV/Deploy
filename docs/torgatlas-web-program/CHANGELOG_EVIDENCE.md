# Evidence changelog

## Wave 01 — 2026-10-14 (локально, не production)

- Создан отдельный worktree от подтверждённого `origin/main`.
- AI-search UI переведён в fail-closed режим: до `enabled:true` выполняется только GET статуса, пользовательский query не отправляется.
- Исправлены два устаревших ожидания тестов и performance-check для hash query CSS.
- Production не изменялся; runtime verification остаётся UNKNOWN из-за timeout из текущей среды.
