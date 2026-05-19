# Knowledge Base — Design Spec

User ask: a sidebar "Knowledge" page that includes Skills + company-shared
knowledge + per-person connected data sources.

## Goals

1. **One discoverable surface** for everything the workspace + each user
   "knows", not three separate pages.
2. **Company knowledge as a first-class entity** — markdown docs the team
   shares (FAQs, decisions, runbooks, onboarding notes). Editable by any
   workspace member.
3. **Per-user connections scaffold** — visible list of supported data
   sources (Linear / GitHub / Notion / Slack) with a clear "Connect"
   path that's stubbed for MVP. Real OAuth flows ship in a later phase.
4. Skills stay deep-linkable at `/skills` but get surfaced in the new
   umbrella page so users know where to find them.

## Non-goals (this MVP)

- Real OAuth integrations for the connection types.
- Agent runtime injection — KB docs do NOT yet auto-write into
  CLAUDE.md the way skills do. Wave B.
- Full-text search across KB. List + title filter only.
- Folder/category tree. Flat list of docs grouped by `kind`.
- Per-doc permissions. All workspace members can read + edit + delete
  any KB doc (matches the skills-as-workspace-resource pattern).

## Architecture

### Data model

Two new tables.

**`workspace_knowledge_doc`** — workspace-shared markdown docs.

```
id                uuid  PK
workspace_id      uuid  FK → workspace.id  ON DELETE CASCADE
kind              text  enum: 'general' | 'faq' | 'decision' | 'runbook' | 'onboarding'
title             text  NOT NULL
content           text  NOT NULL DEFAULT ''  (markdown)
created_by        uuid  FK → user.id  ON DELETE SET NULL
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()

INDEX  (workspace_id, updated_at DESC)
INDEX  (workspace_id, kind)
```

**`user_connection`** — per-user data source auth records. MVP keeps
the table empty; the UI lists supported `kind`s as cards and shows
"Connect" buttons that do nothing yet. Schema lives now so the OAuth
phase can wire up without a migration battle.

```
id                uuid  PK
user_id           uuid  FK → user.id  ON DELETE CASCADE
kind              text  enum: 'linear' | 'github' | 'notion' | 'slack'
status            text  enum: 'pending' | 'connected' | 'revoked'  DEFAULT 'pending'
config            jsonb  NOT NULL DEFAULT '{}'   (token meta, scope, etc — never raw secrets)
connected_at      timestamptz
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()

UNIQUE (user_id, kind)   -- one connection per kind per user
```

### API

All under `/api/workspaces/:wsid/...` with the standard auth+workspace
middleware (matches `skills` / `agents` shape).

```
GET    /api/workspaces/:wsid/knowledge            → KnowledgeDoc[]
POST   /api/workspaces/:wsid/knowledge            body: { kind, title, content }  → KnowledgeDoc
GET    /api/workspaces/:wsid/knowledge/:docId     → KnowledgeDoc
PATCH  /api/workspaces/:wsid/knowledge/:docId     body: Partial<{ kind, title, content }>  → KnowledgeDoc
DELETE /api/workspaces/:wsid/knowledge/:docId     → 204
```

Personal connections are user-scoped, not workspace-scoped:

```
GET    /api/me/connections
       → { kinds: [{ kind, status, connected_at|null }] }
       MVP: returns the supported kinds with status='pending' for any
       not in the table. No POST yet.
```

KB docs broadcast `knowledge.created` / `knowledge.updated` /
`knowledge.deleted` on the workspace channel so other tabs refetch.
Connections broadcast nothing (single-user surface).

### UI

```
/[workspaceSlug]/knowledge                   index page (3 sections)
/[workspaceSlug]/knowledge/new               create form
/[workspaceSlug]/knowledge/[docId]           view + inline edit
```

**Index page sections:**

1. **Skills** — single card. Title + count + small list of 3 most-recent
   skills + "Browse all" → `/skills`. Read-only on this page.
2. **Workspace knowledge** — list of KB docs grouped by `kind`. Each
   row: title + author avatar + updatedAt. New button in section
   header opens `/knowledge/new`. Empty state: EmptyState with CTA
   "Add your first doc".
3. **My connections** — grid of cards, one per supported kind. Each
   shows: kind icon + name + status pill. "Connect" button opens a
   stub modal saying "OAuth flow ships in a follow-up". Per-user only.

**Editor page** — uses the existing `ContentEditor` (TipTap markdown)
that issues already use, plus a kind picker, a title input, and
"Save / Delete / Cancel" actions. No multi-version history.

**Sidebar entry** — new "Knowledge / 知识库" link in the existing
"workspace" section, placed between Issues and Projects. Icon:
`Library` from lucide. Active rule: highlights on `/knowledge` and
`/knowledge/...`.

### Why these boundaries

- The `workspace_knowledge_doc` table mirrors `skills` deliberately —
  same shape (workspace + title + content), so the same hooks/patterns
  slot in. Future Wave B can add agent context injection by reading
  both tables in the same place the runner already reads `agentSkills`.
- `user_connection` is a separate table from anything workspace-scoped
  because the connection is the user's, not the workspace's — a single
  user has the same Linear connection across all their workspaces.
- API splits along the same axis: workspace endpoints vs `/api/me`.

## Test plan

- Server: ~6 new tests in `routes/knowledge.test.ts` (CRUD happy path +
  cross-workspace 404 + auth required).
- Migration: applied locally + verified via the same Supabase
  Management API path used for prior migrations.
- Web: typecheck + manual smoke (open `/knowledge`, create a doc, edit
  it, delete it).
- Production: migration pushed via Management API BEFORE the code that
  reads the new tables ships, same dance as prior migration waves.

## Risks

| risk | mitigation |
|---|---|
| OAuth integrations slip indefinitely → "My connections" stays a stub | acceptable — visible cards set user expectation, the empty list isn't deceptive |
| KB docs grow unbounded without categories | the `kind` enum gives 5 buckets, enough for 100s of docs before users ask for folders |
| TipTap markdown editor differs across kinds (issue body vs KB doc) | reuse the same `ContentEditor` — divergence is the bigger risk |
| Migration order vs deploy | follow the established sequence: push migration via Management API → verify schema → push code |
