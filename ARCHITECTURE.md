# Architecture Manifesto — Source of Truth

> **Read this file before any code modification.**
> This document defines the Standard Operating Procedures (SOPs) for the
> OXS CPaaS platform. All contributors (human and AI) must comply.

---

## 1. Core Principles

### 1.1 Modular Routes — No Logic in Route Files
Route files (`server/routes/*.ts`) are **thin dispatchers**. They:
- Parse and validate request parameters
- Call the appropriate service method
- Return the response

**Forbidden in route files:**
- Database queries or model access
- Business logic, calculations, or transformations
- Direct webhook payload processing

All logic belongs in `server/services/`.

### 1.2 Dynamic Webhook Routing
All WhatsApp webhook endpoints use the **identifier pattern**:

```
["/api/whatsapp/webhook", "/api/whatsapp/webhook/:identifier"]
```

- The `:identifier` segment carries the phone number or channel reference from the URL Meta was configured with.
- Both routes are registered (array syntax) for backward compatibility with Meta's existing webhook configuration.
- The identifier is injected into the enriched body as `_urlIdentifier` before passing to the service layer.
- **Never** route messages based on the URL identifier alone — it is used for cross-validation only.

### 1.3 The Gatekeeper Pattern
Every inbound webhook is **cross-validated** before processing:

1. **URL identifier** (from the route param) is normalized via `normalizePhoneForMatch()`.
2. **Payload phone** (`display_phone_number` from the webhook body) is normalized the same way.
3. If they **mismatch**, the system:
   - Logs `[gatekeeper] WEBHOOK_URL_MISMATCH`
   - Records an audit step `WEBHOOK_URL_VALIDATION` with FAIL status
   - **Still processes the message** using the internal `phoneNumberId` (never drops data)
   - Always returns HTTP 200 to Meta

This lives in `whatsapp-webhook.service.ts → processIncomingWebhook()`.

### 1.4 No Monoliths
- `server/index.ts` is the **bootstrap file only** — it connects to MongoDB, mounts routes, and starts Express. No business logic.
- Route files must not grow beyond ~200 lines of dispatching code. If a route file is getting large, extract a new service.
- Services should be single-responsibility. If a service exceeds ~500 lines, consider splitting.

### 1.5 Configuration First
New phone numbers, static overrides, and channel mappings go in configuration files:

| What | Where |
|------|-------|
| Static phone → tenant routing | `server/lib/constants/static-routes.ts` → `STATIC_PHONE_ROUTES` |
| Read-only tenant enforcement | `server/lib/constants/static-routes.ts` → `READ_ONLY_TENANT_SLUGS` |
| Rate limits and buffer sizes | `server/lib/constants/limits.ts` |
| Channel display mapping | `CHANNEL_MAP` constant in the relevant service |

**Never hardcode** phone numbers, tenant slugs, or routing logic inside service functions or route handlers.

### 1.6 Responsive First — Adaptive UI

Every new UI component **must be adaptive**. Use Tailwind CSS responsive prefixes
(`sm:`, `md:`, `lg:`) to ensure features work on both mobile and desktop from
day one.

#### Mobile UI Strategy

| Area | Mobile (<768 px) | Desktop (≥768 px) |
|------|------------------|--------------------|
| Login | Full-screen (`w-full h-full`), borderless card, `h-12` touch inputs | Centered card (`max-w-md`), standard borders/shadow |
| Inbox / Monitor | **Stack Navigation** — one view at a time (list OR chat, never both) | **Column Layout** — side-by-side panels with resizable dividers |
| Navigation | Hamburger menu via `SidebarTrigger` (opens Sheet overlay) | Permanent sidebar |
| CRM Panel | Hidden (`hidden lg:flex`) | Visible alongside chat |

#### Component Reusability Rule

Business logic **must be decoupled** from layout. A single component handles
data fetching, state, and mutations. CSS (via Tailwind breakpoints) handles
arrangement based on screen size.

```
✅  <ConversationListPanel>  →  one component, responsive classes
❌  <MobileConversationList> + <DesktopConversationList>
```

#### Safety Guardrail

> **NEVER create separate pages or components for mobile.**
> Use conditional rendering and Tailwind breakpoints to maintain a
> **single URL / single entry point** per feature.

#### Implementation Conventions

- Base classes = mobile layout (smallest screen)
- `md:` prefix = desktop overrides (restore desktop appearance)
- Inline styles that set dynamic widths must use CSS variables
  consumed via `md:w-[var(--name)]` so mobile can override with `w-full`
- Touch targets: minimum `h-10` on mobile inputs/buttons (`h-12` preferred)
- `data-testid="mobile-view"` on key mobile-only wrappers for test targeting
- Existing `mobileView` state in Inbox (`"list" | "chat"`) controls which
  panel is visible on small screens — extend this pattern for new inbox features

### 1.7 Multi-Tenancy — Database-per-Tenant
- Central MongoDB database holds: Tenants, Channels, Users, SystemAuditLogs
- Each tenant gets an isolated database: `tenant_<slug>` on Atlas
- All API routes use `req.tenantDbConnection` with factory model pattern
- `server/lib/db-manager.ts` manages the connection pool
- **Never** mix data between tenant databases

### 1.8 Security Layers
- **Encryption at rest**: AES-256-GCM for tenant-sensitive fields (tokens, phone numbers) via `encryption.service.ts`
- **Webhook signature verification**: Meta SHA-256 HMAC validation via `webhook-signature.middleware.ts`
- **HTML sanitization**: DOMPurify with allowlist + safe-style filtering in `ChatWindowPanel.tsx`
- **Rate limiting**: `express-rate-limit` on API endpoints
- **Role-based access**: Middleware guards (`requireAuth`, `requireRole(...)`, `requireTenant`) on all routes
- **GDPR**: `purgeTenantData()` drops all collections in tenant DB

### 1.9 Message Deduplication
- `message-queue.service.ts` implements an in-memory `webhookQueue` and `isDuplicateMessage()` to prevent race conditions during concurrent webhook processing
- **Never** process the same webhook payload twice — always check deduplication before creating messages

---

## 2. Folder Structure & Responsibilities

```
server/
├── index.ts                    # Bootstrap only: DB connect, mount routes, start server
├── routes/                     # Thin HTTP dispatchers (parse → call service → respond)
│   ├── whatsapp.ts             #   Webhook verification + inbound dispatch
│   ├── admin.ts                #   Admin/superadmin endpoints (audit, channels, users, migrations)
│   ├── auth.ts                 #   Authentication (login, OTP, logout, session, presence)
│   ├── inbox.ts                #   Agent inbox operations (conversations, messages, forward, transfer)
│   └── tenants.ts              #   Tenant CRUD + customer fields + settings
├── services/                   # All business logic lives here
│   ├── whatsapp-webhook.service.ts   # Inbound webhook pipeline + gatekeeper (1,250 lines)
│   ├── whatsapp-sender.service.ts    # Outbound message sending + read-only guard
│   ├── whatsapp.service.ts           # WhatsApp API wrapper
│   ├── whatsapp-media.service.ts     # Meta Graph API media download/upload/streaming
│   ├── whatsapp-template.service.ts  # Template management + Meta sync
│   ├── channel.service.ts            # Channel CRUD + display-phone resolution
│   ├── channel-cache.service.ts      # In-memory channel cache (singleton)
│   ├── audit.service.ts              # OMMA trace lifecycle + step recording
│   ├── audit-log.service.ts          # Trace creation + querying
│   ├── audit-alert.service.ts        # Automated alerts on audit failures (email + SMS)
│   ├── encryption.service.ts         # AES-256-GCM encrypt/decrypt
│   ├── tenant.service.ts             # Tenant CRUD + DB provisioning + GDPR purge
│   ├── auth.service.ts               # OTP, sessions, tenant-scoped login
│   ├── conversation.service.ts       # Conversation lifecycle
│   ├── routing.service.ts            # Message routing decisions (Sticky Agent, Round Robin, Pool)
│   ├── message-queue.service.ts      # Webhook queueing + deduplication
│   ├── storage.service.ts            # S3/MinIO object storage for media
│   ├── transcode.service.ts          # Video/audio transcoding for browser compatibility
│   ├── video-processing.service.ts   # Video processing pipeline
│   ├── socket.service.ts             # Real-time Socket.io events + room management
│   ├── change-stream.service.ts      # MongoDB Change Streams → socket events
│   ├── snooze-wake.service.ts        # Conversation snooze scheduler + background job
│   ├── sms.service.ts                # SMS sending
│   ├── sms-template.service.ts       # SMS template management
│   ├── email.service.ts              # SendGrid integration
│   ├── proxy.service.ts              # QuotaGuard static IP proxy
│   ├── communication-log.service.ts  # Unified outbound/inbound log (audit + billing)
│   ├── translation-override.service.ts # Per-tenant i18n key overrides
│   ├── system-settings.service.ts    # Global system configuration
│   ├── user.service.ts               # User CRUD + presence
│   └── ...                           # One service per domain concern
├── models/                     # Mongoose schemas + TypeScript interfaces (21 models)
│   ├── tenant.model.ts         #   Multi-tenant config, SLA, quotas, custom fields
│   ├── channel.model.ts        #   WhatsApp channel: phoneNumberId, encrypted credentials
│   ├── conversation.model.ts   #   Conversation: assignedTo, status, tags, snooze, orphan
│   ├── message.model.ts        #   Message: content, type, media, forwarding metadata
│   ├── customer.model.ts       #   Customer: name, phone, custom fields
│   ├── user.model.ts           #   User: role, teamIds, tenant scope
│   ├── SystemAuditLog.ts       #   OMMA: trace with steps, diagnosis, encryption, 30d TTL
│   ├── AuditAlertConfig.ts     #   Automated email alert configuration
│   ├── active-session.model.ts #   24-hour WhatsApp session tracking (LIFO)
│   ├── presence-log.model.ts   #   Agent status history (Active, Break, Busy, Offline)
│   ├── team.model.ts           #   Team/department with color
│   ├── tag.model.ts            #   Tags (team-scoped optional)
│   ├── quickReply.model.ts     #   Agent quick replies
│   ├── whatsapp-template.model.ts #  WhatsApp message templates
│   ├── sms-template.model.ts   #   SMS templates
│   ├── communication-log.model.ts # Unified communication log
│   ├── suggested-knowledge.model.ts # AI-suggested replies knowledge base
│   ├── translation-override.model.ts # Per-tenant i18n overrides
│   ├── system-settings.model.ts #  Global system settings
│   ├── session.model.ts        #   Express sessions
│   └── template-tag.model.ts   #   Template categorization tags
├── middleware/                  # Express middleware
│   ├── auth.middleware.ts      #   JWT/session validation + role guards
│   └── webhook-signature.middleware.ts  # Meta SHA-256 HMAC signature verification
├── lib/                        # Shared utilities and infrastructure
│   ├── constants/              #   Static configuration maps
│   │   ├── static-routes.ts    #     Phone → tenant static routing + read-only sets
│   │   └── limits.ts           #     Rate limits, buffer sizes, timeouts
│   ├── db-manager.ts           #   Multi-tenant DB connection pool
│   ├── with-timeout.ts         #   Promise timeout wrapper
│   ├── trace-buffer.ts         #   OMMA audit trace buffering (in-memory with TTL)
│   └── graceful-shutdown.ts    #   Clean shutdown handler
├── utils/                      # Pure utility functions (no side effects)
└── scripts/                    # One-off migration and maintenance scripts

client/src/
├── pages/                      # Page-level components (19 pages)
│   ├── dashboard.tsx           #   Main dashboard
│   ├── inbox.tsx               #   Agent inbox (orchestrator)
│   ├── analytics.tsx           #   Detailed analytics dashboard
│   ├── customers.tsx           #   Customer management
│   ├── tenants.tsx             #   Tenant administration
│   ├── settings.tsx            #   System settings (teams, tags, SLA)
│   ├── whatsapp-templates.tsx  #   WhatsApp template management
│   ├── sms-templates.tsx       #   SMS template management
│   ├── knowledge.tsx           #   Knowledge base / suggested replies
│   ├── tags.tsx                #   Tag management
│   ├── departments.tsx         #   Department/team management
│   ├── dictionary.tsx          #   Translation override dictionary
│   ├── communication-log.tsx   #   Communication log viewer
│   ├── audit-log.tsx           #   Audit log viewer
│   ├── users-page.tsx          #   User management
│   ├── login.tsx               #   Tenant-scoped login (/login/:slug)
│   ├── admin-login.tsx         #   Admin login (no tenant context)
│   └── admin/
│       └── MessageMonitor.tsx  #   OMMA webhook audit dashboard
├── components/
│   ├── ui/                     #   shadcn/ui primitives (40+ components)
│   ├── inbox/                  #   Inbox-specific components
│   │   ├── ChatWindowPanel.tsx #     Chat view: messages, input, actions (1,652 lines)
│   │   ├── ConversationListPanel.tsx # Conversation sidebar list
│   │   ├── CustomerDetailsPanel.tsx  # CRM panel
│   │   ├── ForwardMessageDialog.tsx  # Message forwarding
│   │   ├── media-components.tsx      # Lazy-loading media (PDF, TIFF, video)
│   │   ├── messages/                 # Per-type message renderers
│   │   ├── helpers.ts                # Media batch loading, utilities
│   │   └── types.ts                  # Channel line map, shared types
│   ├── rich-text-editor.tsx    #   TipTap rich text editor
│   ├── presence-daily-report.tsx #  Agent status duration (AHT tracking)
│   ├── app-sidebar.tsx         #   Navigation sidebar
│   ├── theme-toggle.tsx        #   Dark/light mode toggle
│   ├── language-switcher.tsx   #   i18n locale switcher
│   └── role-switcher.tsx       #   Role context switcher
├── hooks/
│   ├── use-mailbox-data.tsx    #   Inbox data orchestration (749 lines)
│   ├── use-inbox-socket.tsx    #   Real-time socket events (494 lines)
│   ├── use-inbox-mutations.tsx #   Inbox API mutations (473 lines)
│   ├── use-inbox-filters.tsx   #   3-layer filtering: Channels, Statuses, Tags
│   ├── useTemplateManager.tsx  #   WhatsApp template CRUD
│   └── ...                     #   Toast, theme, mobile detection
├── lib/
│   ├── locales/                #   i18n: he.json, en.json, ar.json, ru.json, tr.json
│   ├── auth-context.tsx        #   Auth provider + useAuth hook
│   ├── role-context.tsx        #   Role provider + useRole hook
│   ├── i18n.ts                 #   i18n setup + RTL detection
│   ├── queryClient.ts          #   TanStack Query config + apiRequest
│   └── constants/              #   Frontend constants
└── types/                      # TypeScript type definitions

shared/
└── schema.ts                   # Zod schemas + Drizzle types shared between FE/BE
```

---

## 3. Webhook Pipeline Flow

```
Meta POST → /api/whatsapp/webhook/:identifier
  │
  ├─ Middleware: verifyWhatsAppSignature (SHA-256 HMAC)
  │
  ├─ Route: extract identifier, parse entries, enrich body
  │
  ├─ Queue: isDuplicateMessage() check (deduplication)
  │
  └─ Service: processIncomingWebhook()
       │
       ├─ 1. Gatekeeper: cross-validate URL identifier vs payload phone
       ├─ 2. Static Routes: check STATIC_PHONE_ROUTES (bypass cache/DB)
       ├─ 3. Channel Cache: lookup by phoneNumberId
       ├─ 4. DB Fallback: findTenantByPhoneNumberId (if cache miss)
       ├─ 5. Display Phone Heal: cross-reference by normalized phone
       ├─ 6. Fallback Channel: route to any available tenant (last resort)
       ├─ 7. Session Tracking: update 24h active session (LIFO)
       │
       └─ Always return HTTP 200 to Meta (never drop webhooks)
```

---

## 4. Resolution Priority Order

1. **Static Routes** (`STATIC_PHONE_ROUTES`) — hardcoded phone → tenant mapping
2. **Channel Cache** — in-memory `byPhoneNumberId` index
3. **Database Lookup** — `Channel.findOne({ phoneNumberId })` with timeout
4. **Display Phone Cross-Reference** — match by normalized phone number
5. **Fallback Channel** — any active tenant (message marked as orphan)

---

## 5. Real-Time Architecture

```
Backend Events                     Frontend Consumers
─────────────                      ──────────────────
socket.service.ts                  use-inbox-socket.tsx
  ├─ newMessage                      ├─ Update TanStack Query cache
  ├─ conversationUpdated             ├─ Optimistic UI updates
  ├─ typingIndicator                 ├─ Typing bubble
  ├─ presenceChange                  ├─ Agent status indicators
  └─ ...                             └─ Toast notifications

change-stream.service.ts
  └─ MongoDB Change Streams → socket.service.ts emit
```

- Rooms are scoped per tenant and per conversation
- Frontend `use-inbox-socket.tsx` subscribes to events and updates TanStack Query cache directly

---

## 6. Media Pipeline

```
Inbound Media (WhatsApp → Server → Storage):
  Meta webhook → whatsapp-media.service.ts (download from Meta API)
    → transcode.service.ts (if video/audio needs browser compatibility)
    → storage.service.ts (upload to MinIO/S3)
    → message.model.ts (store mediaUrl reference)

Outbound Media (Agent → WhatsApp):
  Upload via /api/inbox/upload → storage.service.ts → MinIO
  Send via whatsapp-sender.service.ts → Meta API

Streaming (Frontend playback):
  GET /api/inbox/messages/:id/media/stream → presigned URL from MinIO
```

---

## 7. Authentication & Authorization

- **Tenant-scoped login**: `/login/:slug` resolves tenant, scopes user lookup
- **OTP verification**: SMS or Email with tenant-specific or global fallback credentials
- **Roles**: `superadmin` > `businessadmin` > `teamleader` > `employee`
- **Middleware**: `requireAuth`, `requireRole(...)`, `requireTenant`
- **Admin access**: `/admin` route (no tenant context, superadmin only)
- **Agent Presence**: Real-time status tracking (Active, Break, Busy, Offline) via `presence-log.model.ts`

---

## 8. Anti-Patterns — Do NOT

| Anti-Pattern | Correct Approach |
|---|---|
| Add DB queries in route files | Move to a service method |
| Hardcode a phone number in a service | Add to `static-routes.ts` or channel config |
| Put business logic in `index.ts` | Create or use an existing service |
| Match channels by fuzzy/partial name | Use exact `phoneNumberId` or exact normalized phone only |
| Drop webhooks on validation failure | Log the failure, still process the message |
| Skip audit step recording | Every pipeline decision must be traced |
| Create a new route file for one endpoint | Add to the relevant existing route file |
| Import models directly in routes | Access data through service methods |
| Create separate mobile pages/components | Use Tailwind responsive prefixes on a single component |
| Use `@media` queries or inline `<style>` blocks | Use Tailwind `sm:`/`md:`/`lg:` prefixes exclusively |
| Set dynamic widths via inline `style={{ width }}` without mobile override | Use CSS variable + `w-full md:w-[var(--name)]` |
| Use `innerHTML` with unsanitized user input | Always sanitize with DOMPurify first |
| Mix data between tenant databases | Isolate per-tenant via `req.tenantDbConnection` |
| Process duplicate webhook payloads | Check `isDuplicateMessage()` before creating messages |

---

## 9. Adding a New Phone Number / Channel

1. If it's a **static override** (external system, no DB channel): add entry to `STATIC_PHONE_ROUTES` in `server/lib/constants/static-routes.ts`
2. If it's **read-only** (monitoring only, no outbound): also add tenant slug to `READ_ONLY_TENANT_SLUGS`
3. If it's a **normal channel**: create via admin UI or API — the channel cache will auto-populate on next rebuild
4. **Never** add phone-specific if/else blocks inside service logic

---

## 10. Diagnosis & Monitoring (OMMA)

- **17 diagnosis codes** in `classifyFailure()` — each maps to a specific pipeline failure mode
- Every diagnosis has: StatusBadge color/icon, inline panel theme, Learning Center entry, i18n keys in all 5 locales
- **Active Alerts**: `audit-alert.service.ts` sends email + SMS on critical failures
- **Channel Health Check**: Meta Graph API validation from admin dashboard
- New diagnosis codes must follow this checklist:
  1. Add classification logic in `classifyFailure()`
  2. Add StatusBadge rendering in `MessageMonitor.tsx`
  3. Add inline diagnosis panel color/icon case
  4. Add Learning Center entry with title/desc/fix
  5. Add i18n keys in he/en/ar/ru/tr

---

## 11. Key Dependencies

| Category | Packages |
|----------|----------|
| **Framework** | Express 5, React 18, Vite |
| **Database** | Mongoose 9, MongoDB Atlas |
| **UI** | Tailwind CSS v4, shadcn/ui, Radix UI, Lucide icons |
| **State** | TanStack Query v5, react-hook-form, Zod |
| **Real-time** | Socket.io 4.8 |
| **Rich Text** | TipTap (10 extensions) |
| **Media** | AWS S3 SDK (MinIO), pdfjs-dist |
| **Auth** | passport-local, bcryptjs, express-session |
| **i18n** | i18next, react-i18next (5 locales) |
| **Email** | @sendgrid/mail |
| **Charts** | Recharts |
| **Routing** | wouter |
| **DnD** | @dnd-kit/core + sortable |
| **Animation** | framer-motion |

---

## 12. External Integrations

| Service | Purpose | Config |
|---------|---------|--------|
| **Meta WhatsApp Business API** | Send/receive WhatsApp messages | Per-channel encrypted credentials |
| **MongoDB Atlas** | Primary database | `MONGODB_URI` env var |
| **SendGrid** | Email sending (OTP, alerts) | Per-tenant or global API key |
| **AWS S3 / MinIO** | Media file storage | `MINIO_*` env vars |
| **QuotaGuard** | Static IP proxy for WhatsApp API | `QUOTAGUARDSTATIC_URL` env var |
| **Cuttly** | URL shortening for payment links | API key in tenant config |

---

*Last updated: 2026-03-13 — Full update: added §1.7-1.9, expanded folder structure with all 21 models + 25 services, added §5-7 (Real-Time, Media Pipeline, Auth), expanded §8 anti-patterns, added §11-12 (Dependencies, Integrations)*
