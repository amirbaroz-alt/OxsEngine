# Future Architecture: CPaaS Modular Multi-Frontend (Planned)

**Status**: PLANNED — not yet implemented.
**Reference**: `attached_assets/מסמך_איפיון_ופרומפטים_CPaaS.md_(1)_*.docx`

The system will be restructured from a single monolithic frontend into a modular multi-frontend architecture following a "Headless Everything" philosophy — full separation between business logic (backend API) and presentation (multiple React apps).

## Target Structure

- **Backend**: All business logic routes under `/api/cpaas/`, centralized auth under `/api/auth/`. Backend serves API only (headless).
- **3 Frontend Apps** (under `client/src/apps/`):
  1. `super-admin/` — Platform control panel (tenant management, system logs, billing stats). Accessible at `/admin`.
  2. `tenant-cpaas/` — Standard SaaS interface for tenants (Inbox, Campaigns, Contacts, Analytics). Accessible at `/cpaas`.
  3. `bank-project/` — Custom client app demonstrating component embedding. Bank-branded layout with own nav (Accounts, Transfers, Loans) that embeds CPaaS components. Accessible at `/bank`.
- **Shared Component Library** (`client/src/components/cpaas-core/`): ChatWindowPanel, ConversationListPanel, ForwardMessageDialog extracted as reusable components receiving data via props/context (not global state).
- **Auth Routing**: After login, redirect based on role — SuperAdmin→`/admin`, BankUser→`/bank`, else→`/cpaas`.

## Implementation Order (4 phases)

1. **Backend restructure**: Isolate API under `/api/cpaas/`, centralize auth under `/api/auth/`, enforce tenantId on all routes.
2. **Shared UI extraction**: Move core CPaaS components to `cpaas-core/`, refactor to accept props instead of global state.
3. **Super Admin + Tenant CPaaS apps**: Create separate layouts and entry points with React Router/Wouter routing by URL path.
4. **Bank Project**: Build custom bank layout embedding `cpaas-core` components, proving modularity.

## Key Architectural Rules

- Components in `cpaas-core/` must receive `tenantId`, `currentUserId` via props or localized context — no hardcoded globals.
- All 3 apps share the same login page and auth mechanism.
- Backend remains a single Express server serving all APIs; frontend routing determines which app loads.
