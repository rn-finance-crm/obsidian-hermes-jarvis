# SerpApi Integration Plan (Web Search Default)

Goal: integrate **SerpApi** as a first-class web search provider, add settings for its API key, and make `internet_search` prefer SerpApi when a SerpApi key is available.

Scope includes:
- provider implementation,
- settings/UI updates (including registration link),
- default provider resolution logic,
- explicit provider indication in tool/system output.

---

## Desired behavior

1. If `serpApiKey` exists, `internet_search` uses **SerpApi by default**.
2. If no `serpApiKey`, existing provider selection/fallback continues to work.
3. Settings page exposes a **SerpApi API key** field and a **registration link** (`https://serpapi.com/users/sign_up`).
4. Tool output/system message clearly states which provider ran (e.g. `Provider: serpapi`).

---

## Implementation tasks

### Task 1: Extend settings and types for SerpApi

Files:
- `types.ts`
- `obsidian/HermesSettingsTab.ts`
- any shared settings interfaces used by React settings state (`App.tsx`, `components/Settings.tsx` props)

Changes:
- Add `serpApiKey?: string` to app/plugin settings types.
- Extend provider union:
  - from `'google' | 'serper' | 'perplexity'`
  - to `'google' | 'serper' | 'serpapi' | 'perplexity'`.
- Keep backward compatibility for existing saved settings.

Acceptance:
- Typecheck passes with new provider value.
- Existing persisted settings load without migration errors.

---

### Task 2: Add SerpApi provider implementation

File:
- `services/webSearchProviders.ts`

Changes:
- Add `SerpApiProvider implements WebSearchProviderInterface`:
  - endpoint: `https://serpapi.com/search.json`
  - params: `engine=google`, `q=<query>`, `api_key=<key>`, `num=10`.
- Parse `organic_results` (plus optional `answer_box` / `related_questions` when available).
- Return normalized `SearchResult` shape with:
  - `metadata.provider = 'serpapi'`
  - `metadata.duration`
  - `metadata.resultCount`
  - synthetic `groundingChunks` from result URLs/titles for UI compatibility.
- Register provider in registry map.

Acceptance:
- `getProvider('serpapi')` returns a working provider.
- Errors are surfaced as `SerpApi search failed: ...` with HTTP status context.

---

### Task 3: Default-provider resolution in tool

File:
- `tools/web_search.ts`

Changes:
- Add deterministic resolver for active provider:
  1. if `settings.serpApiKey` present -> use `serpapi` (default override)
  2. else use configured `settings.webSearchProvider` (existing behavior)
  3. if configured provider key missing, fall back to available key in priority order: `serpapi` -> `serper` -> `google` -> `perplexity`.
- Add API-key selection branch for `serpapi`.
- Keep clear missing-key error messages with guidance to settings.

Acceptance:
- With only `serpApiKey` set, `internet_search` succeeds without changing provider dropdown.
- With no `serpApiKey`, behavior remains compatible with current setup.

---

### Task 4: Show SerpApi in settings + registration link

Files:
- `obsidian/HermesSettingsTab.ts`
- `components/Settings.tsx` (standalone/settings modal)
- `App.tsx` (state wiring if needed)

Changes:
- Add new password input: **SerpApi API key**.
- Add inline registration/help link: `https://serpapi.com/users/sign_up`.
- Update provider dropdown labels to include `SerpApi`.
- Update warning text logic to include SerpApi when selected but key missing.

Acceptance:
- User can save/load `serpApiKey` from both settings surfaces used by the app.
- Registration link is visible and opens in a new tab.

---

### Task 5: Indicate provider in tool output

Files:
- `tools/web_search.ts`
- optionally any UI renderer if additional badge is desired (`components/messages/SystemMessage.tsx` or `components/ToolResult.tsx`)

Changes:
- Ensure system status text and metadata include effective provider (`serpapi`, `serper`, `google`, or `perplexity`).
- Keep current `description: Provider: ...` pattern, but use resolved provider value.

Acceptance:
- Every successful `internet_search` call visibly includes provider name.

---

### Task 6: Docs updates

Files:
- `docs/TOOLS_DOCUMENTATION.md`
- `docs/research/search-providers.md` (already researched; keep link-rich comparison)

Changes:
- Document new provider option (`serpapi`) and setup steps.
- Note default behavior: SerpApi auto-selected when `serpApiKey` exists.

Acceptance:
- Docs match runtime behavior and settings labels.

---

### Task 7: Verification checklist

1. Set only `serpApiKey` -> run `internet_search` -> provider shows `serpapi`.
2. Remove `serpApiKey`, keep `serperApiKey`, provider configured `serper` -> uses serper.
3. Configure `google` only -> uses Gemini Google search provider.
4. Missing keys for configured provider -> falls back according to priority, else clear error.
5. Obsidian settings reload persists `serpApiKey` correctly.

---

## Non-goals (for this plan)

- No changes to `image_search` provider routing in this pass.
- No pricing/usage dashboard integration.
- No provider-specific caching layer.

---

## Rollout and risk notes

- Risk: changing provider defaults can surprise users currently pinned to another provider.
  - Mitigation: make behavior explicit in docs and settings description (`SerpApi key present => default for web search`).
- Risk: response shape differences across providers.
  - Mitigation: keep strict normalization in provider adapter and preserve `groundingChunks` compatibility.
