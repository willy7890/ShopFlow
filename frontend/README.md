# ShopFlow – Frontend

AI-powered, offline-first Shop Management & POS for Tanzanian shops. **React + TypeScript + Vite + Tailwind**, bilingual (Kiswahili default / English), light & dark themes.

## Quick start
```bash
npm install
cp .env.example .env      # already present as .env
npm run dev               # http://localhost:5173
```
Start the backend from `../backend` with `uvicorn app.main:app --reload`, then register a user or sign in with a backend account. The browser app uses FastAPI; in-memory fixtures are only selected in the test build.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run typecheck` | `tsc` strict type-check |
| `npm test` | Vitest: i18n parity, cart maths, mock-backend rules, and render/flow tests for every screen (34 tests) |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Serve the production build locally |

## Connect the real FastAPI backend
1. Set `VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1` in `.env` (`.env.example` is the local development default). Set it to the deployed FastAPI URL when building for production; production builds must not use a localhost URL.
2. The REST adapter maps frontend operations to FastAPI endpoints in `src/api/http.ts`. The Axios client sends the active `X-Business-ID` and bearer token automatically and rotates access/refresh tokens after an expired access token.
3. The UI contract is `src/api/api.ts` (`Api` interface) with types in `src/api/types.ts`. The mock (`src/api/mock.ts`) documents the rules the backend must enforce:
   - `GET /auth/me` must return `{ user{role,permissions[]}, business, stores[], entitlements{features{},limits{}} }`. **Menus, guards and plan limits come only from this payload.**
   - Stock changes only through sales, purchases, restocks and adjustments (never direct edits).
   - Completed sales are never edited, only voided with a reason.
   - Mobile money is "confirmed" only after the provider confirms.
   - `POST /sync/push` must be idempotent by `clientId` and may answer `conflict`.
   - A `401` makes the client log out and show "session expired".

## Architecture
```
src/
  api/        api.ts (contract) · types.ts · http.ts (real REST) · mock.ts (dev only) · client.ts (axios, 401 handling)
  i18n/       sw.ts · en.ts (all UI text; parity enforced by a test) · index.ts (useT)
  store/      auth.ts (session, permissions) · ui.ts (language, theme, sidebar) – Zustand, persisted
  offline/    db.ts (IndexedDB) · sync.ts (queue, sync engine, conflict resolution)
  components/ AppShell.tsx (sidebar, header, mobile nav, guards) · ui.tsx (form/table/modal kit) · Scanner.tsx (camera)
  features/   auth · dashboard · catalog (products, categories) · inventory · pos (POS, quick sales, receipt)
              sales (sales, invoices) · people (customers, debts, suppliers, purchases) · finance (expenses, cashbook, reports)
              ai · admin (employees, stores, subscription, settings, sync)
  lib/        cart.ts (totals/payment rules) · utils.ts · queryClient.ts
```
Server state: TanStack Query · App state: Zustand · Forms: React Hook Form + Zod · Charts: Recharts (lazy-loaded) · Icons: Lucide.
Routes are lazy-loaded. Tailwind colours are CSS variables, so dark mode needs no per-component colours.
This Vite application is the existing browser frontend and is retained for comparison while the product is migrated. It is not the Android application and must not be wrapped in a WebView, Tauri, or Electron. The native Android-first app is in `../mobile/`.

## Module status (be honest with yourself before shipping)
| Area | Status |
|---|---|
| Auth (login, register, session expiry), 6-step onboarding | Connected to FastAPI; password recovery endpoints are not implemented |
| Shell: sidebar (19 modules), store selector, language/theme, offline pill, mobile bottom nav, permission + plan + mode gating | Built |
| Dashboard, Products (variants, photo, barcode scan, quick **+ Mzigo** restock), Categories (tree), Inventory (stock, movements, adjustments) | Mixed: reads use FastAPI; some writes still need backend routes |
| POS (barcode/camera scan, tiles, discounts, split payments, receipt print/share), Quick Sales, Sales + Payments, Invoices (void) | Built |
| Customers, Debts (aging), Suppliers, Purchases (pack → unit conversion), Expenses, Cashbook, Reports | Reads and supported writes use FastAPI; expense posting uses cashbook entries |
| AI assistant UI | Connected to the configured backend assistant provider; backend returns an explicit error when no provider is configured |
| Offline queue, sync, conflict review | Built; queue persists in IndexedDB. Only **sales** are queued offline |
| Employees, Stores, Subscription, Settings | Built; see gaps |

### Known gaps / TODO
- Live API health, OpenAPI, login routing and CORS preflight were checked locally. Visual QA, camera scanning on real phones and printing still need manual testing.
- Camera scanning uses native `BarcodeDetector` (Chrome/Android) with a ZXing fallback; test on your target devices.
- Offline: only sales are queued; other writes need a connection. Catalog cache is in TanStack Query memory (add `persistQueryClient` for a cold-start offline catalog).
- Reports and dashboard assume backend-calculated figures; the UI labels estimates as estimates.
- Per-store stock/sales comparison and stock transfers/counts need backend endpoints (UI shows the store list only).
- Product photos are sent as small base64 JPEGs; the real backend should accept an upload and return a URL.
- Receipt "PDF download" is not implemented (browser print only). Email/phone verification, change-password and account deletion call no endpoint yet (`Settings.tsx` has TODOs).
- shadcn/ui was not added; a small Tailwind component kit (`components/ui.tsx`) is used. You can add shadcn components gradually.
- `reference/shopflow-preview.html` is the earlier single-file clickable prototype (all 9 phases) kept for design reference only.
