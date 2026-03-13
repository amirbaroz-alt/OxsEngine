# OXS CPaaS Platform — Architecture Export

> Generated: 2026-03-13

---

## 1. Platform Overview

**OXS** is a multi-tenant B2B SaaS platform that combines:
- **CPaaS (Communication Platform as a Service)** — WhatsApp, SMS, Email omnichannel messaging
- **CRM** — Customer management with per-tenant custom fields
- **Agent Inbox** — Real-time customer support workspace with conversation routing
- **Bank Reconciliation** — Payment request lifecycle, FIFO bank account assignment, auto-matching
- **OMMA (Observability)** — End-to-end webhook audit trail with active alerts and retry

**Tech Stack:**
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Radix UI, TanStack Query v5, wouter, Socket.io-client, i18next (5 locales: he/en/ar/ru/tr), TipTap rich text editor
- **Backend:** Node.js, Express 5, TypeScript, Mongoose ODM, Socket.io, SendGrid, AWS S3 (MinIO), passport-local
- **Database:** MongoDB Atlas — database-per-tenant architecture (central DB + `tenant_<slug>` per tenant)
- **External APIs:** Meta WhatsApp Business API (v21.0), SendGrid (email), Cuttly (URL shortener), QuotaGuard (static IP proxy)

**Codebase Size:** ~265 source files, ~30K lines of application code (77 backend .ts + 113 frontend .tsx/.ts)

---

## 2. Folder Structure

```
server/                          # Express backend
├── index.ts                     # Bootstrap: DB connect, mount routes, start server (226 lines)
├── routes/                      # Thin HTTP dispatchers (6,082 lines total)
│   ├── inbox.ts                 #   Agent inbox operations (2,713 lines)
│   ├── admin.ts                 #   Admin/superadmin endpoints (1,749 lines)
│   ├── tenants.ts               #   Tenant CRUD (822 lines)
│   ├── whatsapp.ts              #   Webhook verification + inbound dispatch (559 lines)
│   └── auth.ts                  #   Authentication (239 lines)
├── services/                    # Business logic layer (6,733 lines total)
│   ├── whatsapp-webhook.service.ts    # Inbound webhook pipeline + gatekeeper (1,250 lines)
│   ├── whatsapp-template.service.ts   # Template management (614 lines)
│   ├── whatsapp-sender.service.ts     # Outbound sending + read-only guard (603 lines)
│   ├── auth.service.ts                # OTP, sessions, tenant-scoped login (436 lines)
│   ├── audit.service.ts               # OMMA trace lifecycle (417 lines)
│   ├── channel.service.ts             # Channel CRUD + display-phone resolution (381 lines)
│   ├── whatsapp-media.service.ts      # Media download/upload/streaming (356 lines)
│   ├── socket.service.ts              # Real-time events (307 lines)
│   ├── transcode.service.ts           # Video/audio transcoding (302 lines)
│   ├── sms.service.ts                 # SMS sending (234 lines)
│   ├── channel-cache.service.ts       # In-memory channel cache (192 lines)
│   ├── message-queue.service.ts       # Message queueing (187 lines)
│   ├── audit-alert.service.ts         # Failure alerts (email + SMS) (161 lines)
│   ├── routing.service.ts             # Conversation assignment logic (152 lines)
│   ├── encryption.service.ts          # AES-256-GCM encrypt/decrypt
│   ├── tenant.service.ts              # Tenant lifecycle + GDPR purge
│   ├── conversation.service.ts        # Conversation CRUD
│   ├── storage.service.ts             # S3/MinIO object storage
│   ├── snooze-wake.service.ts         # Snooze scheduler + background job
│   ├── email.service.ts               # SendGrid integration
│   ├── proxy.service.ts               # QuotaGuard static IP proxy
│   ├── change-stream.service.ts       # MongoDB change streams
│   └── ...                            # Other domain services
├── models/                      # Mongoose schemas (21 models)
│   ├── tenant.model.ts          #   Tenant: multi-tenant config, SLA, quotas, custom fields
│   ├── channel.model.ts         #   WhatsApp channel: phoneNumberId, encrypted credentials
│   ├── conversation.model.ts    #   Conversation: assignedTo, status, tags, snooze, orphan
│   ├── message.model.ts         #   Message: content, type, media, forwarding metadata
│   ├── customer.model.ts        #   Customer: name, phone, custom fields
│   ├── communication-log.model.ts #  Legacy message model (WhatsApp media types)
│   ├── user.model.ts            #   User: role, teamIds, tenant scope
│   ├── SystemAuditLog.ts        #   OMMA: trace with steps, diagnosis, encryption
│   ├── team.model.ts            #   Team/department
│   ├── tag.model.ts             #   Tags (team-scoped optional)
│   ├── quickReply.model.ts      #   Agent quick replies
│   ├── whatsapp-template.model.ts #  WhatsApp message templates
│   └── ...                      #   Session, SMS template, audit alert config, etc.
├── middleware/
│   ├── auth.middleware.ts        # JWT/session + role guards (134 lines)
│   └── webhook-signature.middleware.ts  # Meta signature verification (89 lines)
├── lib/
│   ├── constants/
│   │   ├── static-routes.ts     #   Static phone -> tenant routing + read-only sets
│   │   └── limits.ts            #   Rate limits, buffer sizes, timeouts
│   ├── db-manager.ts            #   Multi-tenant DB connection pool
│   ├── with-timeout.ts          #   Promise timeout wrapper
│   ├── trace-buffer.ts          #   OMMA audit trace buffering (in-memory)
│   └── graceful-shutdown.ts     #   Clean shutdown handler
└── scripts/                     # Migration and maintenance scripts

client/src/                      # React frontend
├── pages/                       # Page-level components (19 pages)
│   ├── inbox.tsx                #   Main agent inbox (orchestrator)
│   ├── admin/MessageMonitor.tsx #   OMMA webhook audit dashboard
│   ├── customers.tsx            #   Customer management
│   ├── tenants.tsx              #   Tenant administration
│   ├── settings.tsx             #   System settings (teams, tags, SLA)
│   ├── whatsapp-templates.tsx   #   WhatsApp template management
│   ├── login.tsx                #   Tenant-scoped login (/login/:slug)
│   ├── dashboard.tsx            #   Analytics dashboard
│   ├── analytics.tsx            #   Detailed analytics
│   └── ...                      #   Dictionary, knowledge, SMS templates, etc.
├── components/
│   ├── inbox/                   # Inbox-specific components (3,216 lines)
│   │   ├── ChatWindowPanel.tsx  #   Chat view: messages, input, actions (1,575 lines)
│   │   ├── media-components.tsx #   Media rendering: image, video, audio, file (644 lines)
│   │   ├── ConversationListPanel.tsx # Conversation sidebar list (435 lines)
│   │   ├── CustomerDetailsPanel.tsx  # CRM panel (397 lines)
│   │   ├── ForwardMessageDialog.tsx  # Message forwarding (165 lines)
│   │   ├── messages/            #   Per-type message renderers
│   │   ├── helpers.ts           #   Media batch loading, utilities
│   │   └── types.ts             #   Channel line map, shared types
│   ├── ui/                      # shadcn/ui primitives (40+ components)
│   └── ...                      # Shared components
├── hooks/                       # Custom React hooks
│   ├── use-mailbox-data.tsx     #   Inbox data orchestration (749 lines)
│   ├── use-inbox-socket.tsx     #   Real-time socket events (494 lines)
│   ├── use-inbox-mutations.tsx  #   Inbox API mutations (473 lines)
│   ├── use-inbox-filters.tsx    #   3-layer filtering logic
│   ├── useTemplateManager.tsx   #   WhatsApp template CRUD (473 lines)
│   └── ...                      #   Toast, theme, mobile detection
├── lib/
│   ├── locales/                 #   i18n: he.json, en.json, ar.json, ru.json, tr.json
│   └── constants/               #   Frontend constants
└── types/                       # TypeScript type definitions
```

---

## 3. Core Architecture Patterns

### 3.1 Multi-Tenancy (Database-per-Tenant)
- Central MongoDB database holds: Tenants, Channels, Users, SystemAuditLogs
- Each tenant gets an isolated database: `tenant_<slug>` on Atlas
- All API routes use `req.tenantDbConnection` with factory model pattern
- Migration script: `server/scripts/migrate-to-multi-tenant.ts`

### 3.2 Modular Routes — No Logic in Route Files
Route files are **thin dispatchers**: parse request -> call service -> return response.
All business logic lives in `server/services/`.

### 3.3 Dynamic Webhook Routing
WhatsApp webhooks use identifier pattern: `/api/whatsapp/webhook/:identifier`
Resolution priority:
1. **Static Routes** (`STATIC_PHONE_ROUTES`) — hardcoded phone -> tenant
2. **Channel Cache** — in-memory `byPhoneNumberId` index
3. **Database Lookup** — `Channel.findOne({ phoneNumberId })` with timeout
4. **Display Phone Cross-Reference** — normalized phone match
5. **Fallback Channel** — any active tenant (message marked orphan)

### 3.4 The Gatekeeper Pattern
Every inbound webhook is cross-validated:
- URL identifier vs payload `display_phone_number` normalized via `normalizePhoneForMatch()`
- Mismatches are logged but message is **never dropped** (always HTTP 200 to Meta)

### 3.5 Real-Time Updates
- Socket.io for live message delivery, typing indicators, presence
- `socket.service.ts` handles room management per tenant/conversation
- Frontend `use-inbox-socket.tsx` subscribes to events and updates TanStack Query cache

### 3.6 Responsive First
- Single component per feature with Tailwind responsive prefixes (`sm:`, `md:`, `lg:`)
- No separate mobile pages — CSS controls layout
- Inbox uses `mobileView` state: `"list" | "chat"` for stack navigation on mobile

---

## 4. Key Features

### 4.1 Agent Inbox
- Multi-conversation management with real-time updates
- Conversation ownership: Sticky Agent, Round Robin, Pool routing
- Actions: Transfer, Snooze (preset + custom), Resolve (with tags/summary), Spam, Merge, Release
- Message forwarding with media preview
- Quick replies, WhatsApp templates
- Rich text editor (TipTap) with formatting toolbar
- 3-layer filtering: Channels, Statuses, Tags
- Agent presence (online/offline)

### 4.2 WhatsApp Integration
- Full media support: image, video, audio, document, sticker, location, contacts
- Interactive messages: button_reply, list_reply, nfm_reply
- Template management (sync with Meta)
- Media streaming endpoint: `/api/inbox/messages/:id/media/stream`
- Read-only channel enforcement for monitoring-only tenants

### 4.3 OMMA Observability System
- **Phase 1**: SystemAuditLog model, TraceBuffer (in-memory with TTL), AuditService
- **Phase 2**: Full webhook pipeline instrumentation with trace steps
- **Phase 3**: Admin dashboard (`/message-monitor`) — stats cards, trace table, diagnosis, decrypt
- **Phase 4**: Active alerts (Email + SMS), retry with re-processing
- 17 diagnosis codes: DB_TIMEOUT, TENANT_NOT_FOUND, AUTH_MISSING, MEDIA_FAILED, etc.
- Channel health check via Meta Graph API

### 4.4 Customer Management
- Per-tenant custom fields (text/number/date/select/combobox/textarea/boolean)
- Configurable UI width, drag-to-reorder
- Orphan customer onboarding from inbox

### 4.5 Bank Reconciliation
- FIFO bank account assignment per tenant
- Payment request lifecycle with cumulative payments
- Auto-match incoming transfers to active requests
- Unidentified transfers dashboard

### 4.6 Teams and Tags
- Team model with color, scoped tags
- Users support multi-team assignment (`teamIds[]`)
- Resolve dialog filters tags by agent's teams

---

## 5. Authentication and Authorization

- **Tenant-scoped login**: `/login/:slug` resolves tenant, scopes user lookup
- **OTP verification**: SMS or Email with tenant-specific or global fallback credentials
- **Roles**: `superadmin`, `businessadmin`, `teamleader`, `employee`
- **Middleware**: `requireAuth`, `requireRole(...)`, `requireTenant`
- **Admin access**: `/admin` route (no tenant context, superadmin only)

---

## 6. Data Models (Key Entities)

| Model | Key Fields |
|-------|-----------|
| **Tenant** | slug, nameHe/En, monthlyMessageQuota, customerFields[], SLA config, active |
| **Channel** | tenantId, phoneNumberId (encrypted), phoneNumber, accessToken (encrypted), type |
| **Conversation** | tenantId, customerId, assignedTo, status, tags[], snoozedUntil, isOrphan |
| **Message** | conversationId, content, type (TEXT/IMAGE/VIDEO/...), direction, metadata, mediaUrl |
| **Customer** | tenantId, firstName, lastName, phone, email, dynamicFields |
| **User** | tenantId, name, email, role, teamIds[], isOnline, lastSeenAt |
| **SystemAuditLog** | traceId, tenantId, steps[], pipelineStatus, diagnosisCode, encrypted content, 30d TTL |
| **Team** | tenantId, name, description, color |
| **Tag** | tenantId, name, color, teamId (optional) |

---

## 7. API Structure

### Routes Summary
| Route File | Prefix | Purpose | Lines |
|------------|--------|---------|-------|
| `auth.ts` | `/api/auth` | Login, OTP verify, logout, session | 239 |
| `whatsapp.ts` | `/api/whatsapp` | Webhook receive, send messages | 559 |
| `inbox.ts` | `/api/inbox` | Conversations, messages, agents, transfers, forward | 2,713 |
| `admin.ts` | `/api/admin` | Audit logs, system stats, channels, users, migrations | 1,749 |
| `tenants.ts` | `/api/tenants` | Tenant CRUD, customer fields, settings | 822 |

### Key Inbox Endpoints
- `GET /api/inbox/conversations` — filtered list (status, tags, channels, agent)
- `GET /api/inbox/conversations/:id/messages` — paginated messages with media
- `POST /api/inbox/conversations/:id/messages` — send message/note
- `POST /api/inbox/conversations/:id/transfer` — transfer to agent
- `POST /api/inbox/conversations/:id/snooze` — snooze with time + target agent
- `POST /api/inbox/conversations/:id/resolve` — resolve with tags/summary
- `POST /api/inbox/forward-message` — forward message to another conversation
- `GET /api/inbox/messages/:id/media/stream` — stream media file

---

## 8. External Integrations

| Service | Purpose | Config |
|---------|---------|--------|
| **Meta WhatsApp Business API** | Send/receive WhatsApp messages | Per-channel encrypted credentials |
| **MongoDB Atlas** | Primary database | `MONGODB_URI` env var |
| **SendGrid** | Email sending (OTP, alerts) | Per-tenant or global API key |
| **AWS S3 / MinIO** | Media file storage | `MINIO_*` env vars |
| **QuotaGuard** | Static IP proxy for WhatsApp API | `QUOTAGUARDSTATIC_URL` env var |
| **Cuttly** | URL shortening for payment links | API key in tenant config |

---

## 9. Security

- **Encryption at rest**: AES-256-GCM for tenant-sensitive fields (tokens, phone numbers)
- **Webhook signature verification**: Meta SHA-256 HMAC validation
- **Rate limiting**: `express-rate-limit` on API endpoints
- **Role-based access**: Middleware guards on all routes
- **GDPR**: `purgeTenantData()` drops all collections in tenant DB
- **Audit trail**: All significant actions logged with actor info

---

## 10. Key Dependencies

| Category | Packages |
|----------|----------|
| **Framework** | Express 5, React 18, Vite |
| **Database** | Mongoose 9, MongoDB Atlas |
| **UI** | Tailwind CSS v4, shadcn/ui, Radix UI, Lucide icons |
| **State** | TanStack Query v5, react-hook-form, Zod |
| **Real-time** | Socket.io 4.8 |
| **Rich Text** | TipTap (10 extensions) |
| **Media** | AWS S3 SDK, pdfjs-dist |
| **Auth** | passport-local, bcryptjs, express-session |
| **i18n** | i18next, react-i18next (5 locales) |
| **Email** | @sendgrid/mail |
| **Charts** | Recharts |
| **Routing** | wouter |
| **DnD** | @dnd-kit/core + sortable |
| **Animation** | framer-motion |

Total: 138 packages (dependencies + devDependencies)

---

## 11. Deployment

- **Platform**: Replit
- **Dev command**: `npm run dev` (Express + Vite dev server)
- **Production**: Replit Deployments with auto-build
- **Environment**: Node.js on NixOS container
- **Domain**: `.replit.app` or custom domain

---

*Last updated: 2026-03-13*
