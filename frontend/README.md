# HadeelOS Frontend — Today Cockpit (PR #10)

React + TypeScript + Vite single-page app that renders the Today Cockpit, wired directly to
the live Decision Engine via the PR #9 API layer. No prototype/mock data — every panel is
derived from the current `TodayDecisionResult` returned by `GET /api/today`.

## Stack

- React 19 + TypeScript, built with Vite
- Vitest + Testing Library for component/unit tests
- oxlint for linting
- No CSS framework — a small hand-written stylesheet (`src/styles.css`) with CSS custom
  properties, dark theme, RTL support, and reduced-motion handling

## Structure

- `src/api/` — typed API client (`client.ts`) and wire-format types (`types.ts`) mirroring
  the backend contract from PR #9. Types are deliberately duplicated rather than imported
  across the package boundary, since the API is the contract between two independent
  deploy targets.
- `src/i18n/` — Arabic (default) and English dictionaries, structurally locked together via
  a shared `TranslationShape` type, plus a `I18nProvider`/`useI18n()` context. Language
  choice persists to `localStorage` and defaults to Arabic/RTL.
- `src/hooks/useTodayCockpit.ts` — the single state owner for the Today Cockpit view. Every
  UI state (loading, offline, error, empty, missing signals, low confidence, uncertain,
  stale, retrying) is derived from the live `TodayDecisionResult` rather than tracked as an
  independent flag.
- `src/components/` — presentational components (`ContextStrip`, `ConfidenceBadge`,
  `WhyPanel`, `ExplainAlternatives`, `ForecastPanel`, `TimelinePanel`, `IfYouDoNothing`,
  `DecisionCard`, `MemoryPanel`, `LanguageToggle`, `StateViews`) plus the top-level
  `TodayCockpit` composition.
- `src/App.tsx` — app shell (skip link, top bar, language toggle) and a temporary demo
  identity (`getOrCreateDemoUserId()`, a `crypto.randomUUID()` persisted to `localStorage`),
  explicitly a placeholder until PR #12 introduces real authentication. No other file
  depends on how identity is established.

## Accessibility

- Skip-to-content link
- Always-visible high-contrast `:focus-visible` outline
- 44px-minimum touch targets on all action buttons
- `aria-label`/`lang` set correctly on the language toggle for screen readers
- `prefers-reduced-motion: reduce` disables all transitions/animations
- RTL layout by default (`dir="rtl"` on `<html>`, mirrored via `[dir="rtl"]` CSS rules)

## Scripts

```
npm run dev         # local dev server
npm run typecheck    # tsc -b --noEmit
npm test             # vitest run
npm run lint          # oxlint
npm run build         # tsc -b && vite build
```

## Backend dependency

Expects the PR #9 API layer reachable at `/api` (configurable via `ApiClient`'s `baseUrl`),
authenticated via the `x-user-id` header per the API layer's current mock auth resolver.
