# Design System — Agora

The visual language for Agora. Read this before making any UI decision. Drift breaks the system; coherence is the whole point.

## Memorable thing

> A serious utility. White paper, one quiet blue, ink. Software for shipping work — not for being looked at.

Every choice below serves that one line. When in doubt, ask: does this stay out of the way and let the data breathe? Anything that draws attention to itself instead of the work is the wrong call.

## Product context

- **What:** AI-agent team collaboration. Issues, agents, autopilot, chat. Treats AI agents as first-class members of the team alongside humans.
- **Who:** 2-10 person startup teams that ship software fast and want their AI agents on the kanban board, not in a side panel.
- **Space:** Issue trackers / project management. Peers: Linear, Height, GitHub Projects.
- **Project type:** Multi-page web app. Editorial-quality typography on a dense data surface.

## Aesthetic direction

**Quiet utility.** Calm, cool grayscale + one brand blue + one warm signal color (priority/warning). Decoration is near-zero — the design gets out of the way of dense data.

What we are NOT:
- Gradient-and-glow SaaS
- Bubble-radius-everything friendly tech
- Material Design utility
- Notion-style approachable
- The cream-and-vermilion palette this project briefly experimented with — the current token set replaced it.

## Typography

| Role | Font | Why |
|---|---|---|
| Body, UI, controls | **Inter** (300-700, variable) | CJK fallbacks (PingFang SC, Noto Sans CJK SC) are wired so 中文 doesn't reflow. Has tabular-nums + `ss01` (slashed zero) + `cv11` (alt 6/9), enabled globally. |
| Display moments | **Source Serif 4** (regular + italic) | Used on issue identifiers, big numbers, page-headline accents. Italic gives the product an editorial soul without being precious. |
| Code, data, monospace | **Geist Mono** | Pairs with body Inter. Falls back to SF Mono / JetBrains Mono. |

Fonts load via Google Fonts CDN at the top of `globals.css`. Self-hosting deferred until we add a font subsetting build step.

Apply `font-display` to a span anywhere we want a number to feel intentional rather than incidental:
- Issue identifiers (`COMPA-1`)
- Large stat numbers
- Time stamps in headers

Body has `font-feature-settings: "ss01" on, "cv11" on` — slashed zero and alt 6/9 are on globally. Tabular numerals are on for body, tables, and anything with `tabular` in a class.

## Color

Three layers:

1. **Cool grayscale** — does almost all the visual work. Hue ≈ 286 (zinc family).
2. **One brand blue** — the only chromatic accent. Buttons, active links, focus ring, selection.
3. **Functional signal colors** — destructive red, success green, priority orange — saturated only enough to read as semantic, never decorative.

### Neutrals — zinc-family grays (Tailwind `gray-*` aliased)

```
gray-50   oklch(0.985 0 0)            near-white surface
gray-100  oklch(0.967 0.001 286.375)  page canvas tint
gray-200  oklch(0.92  0.004 286.32)   default border (workhorse)
gray-300  oklch(0.871 0.006 286.286)  strong border / dividers
gray-400  oklch(0.705 0.015 286.067)  faint text, placeholder
gray-500  oklch(0.552 0.016 285.938)  icons in nav, secondary text
gray-600  oklch(0.442 0.017 285.786)  body text on light surfaces
gray-700  oklch(0.37  0.013 285.805)  emphasis text
gray-800  oklch(0.274 0.006 286.033)  strong text
gray-900  oklch(0.21  0.006 285.885)  primary text (warm ink, never pure black)
gray-950  oklch(0.141 0.005 285.823)  reserved
```

### Accent — brand blue (Tailwind `indigo-*` aliased to brand)

The Tailwind `indigo-*` scale is **aliased** to Agora's brand blue at hue 255, c≈0.16. So every existing `bg-indigo-600` / `text-indigo-700` / `border-indigo-200` reference renders as the brand blue.

```
indigo-50   oklch(0.97 0.014 255)
indigo-100  oklch(0.93 0.04  255)
indigo-200  oklch(0.86 0.08  255)
indigo-300  oklch(0.78 0.12  255)
indigo-400  oklch(0.66 0.15  255)
indigo-500  oklch(0.6  0.16  255)
indigo-600  oklch(0.55 0.16  255)   ✦ THE accent
indigo-700  oklch(0.48 0.15  255)   hover
indigo-800  oklch(0.4  0.13  255)
indigo-900  oklch(0.32 0.1   255)
```

### Functional colors

```
--destructive  oklch(0.577 0.245 27.325)   error / delete
--success      oklch(0.55  0.16  145)      shipped / done
--warning      oklch(0.75  0.16  85)       attention
--info         oklch(0.55  0.18  250)      neutral signal / mention chips
--priority     oklch(0.65  0.18  50)       priority pills
```

Status / priority pills use the functional colors at low chroma so they read as signal, not decoration.

### Surfaces

Pure white background (`oklch(1 0 0)`). Cards + dialogs use the same white — visual separation comes from a hairline border (`var(--border)` = `gray-200`), not a different fill.

### Implementation strategy

Tailwind v4's `@theme` block in `globals.css` redefines `--color-gray-*` and `--color-indigo-*` so every `bg-gray-50` / `text-gray-500` / `bg-indigo-600` reference upgrades automatically. ~350 references across the codebase changed temperament without one line of component code edited.

Semantic utilities defined in `@layer utilities`:
`bg-canvas`, `bg-surface`, `bg-companion` (info), `bg-companion-soft`, `text-companion`, `text-muted`, `text-faint`, `border-default`, `border-strong`, `divide-hairline`.

## Spacing

Base unit: **4px**. Tailwind defaults are fine.

Density: **comfortable** (not compact, not spacious). Roughly 20-30% more padding than a typical SaaS dashboard.

- Page header padding: `px-8 py-5`
- List rows: `px-8 py-3` with hairline `border-b border-gray-200`
- Card padding: `p-3.5`
- Dialog padding: `p-7`

## Layout

Grid-disciplined for app surfaces (sidebars, header bars, lists). Lightly editorial for issue / agent detail pages (max-width content column with generous whitespace).

## Border radius

Restrained. Sharper edges read more expensive.

Driven by a single base token `--radius: 0.625rem` (10px) with derived scales:

```
--radius-sm   0.375rem (6px)   ← nav links, pills, chips
--radius-md   0.5rem   (8px)   ← cards, inputs
--radius-lg   0.625rem (10px)  ← dialogs
--radius-xl   0.875rem (14px)
--radius-2xl  1.125rem (18px)
```

Most things use `rounded-md` (8px) or `rounded-sm` (6px). Avatars are still `rounded-full` (the one exception). Never use `rounded-full` for buttons.

## Shadow

Hair-thin. Most surfaces use a 1px border instead of a shadow. Shadows that exist are barely there:

```
sm        0 1px 2px rgba(0,0,0,.04)
default   0 1px 2px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.04)
md        0 2px 4px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.04)
lg        0 4px 16px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.04)
```

The dialog uses `shadow-xl` + a `border-gray-200` so it pops without feeling Material.

## Motion

Minimal-functional. Only transitions that aid comprehension.

- Default duration: 150ms
- Easing: `transition-colors` for hover; `ease-out` for enters; `ease-in` for exits
- Never bouncy, never decorative

## Component recipes

### Primary button
```
px-3.5 py-1.5 text-[13px] bg-indigo-600 hover:bg-indigo-700
text-white rounded-md font-medium transition-colors
```

### Secondary button
```
px-3.5 py-1.5 text-[13px] text-gray-700 hover:text-gray-900
hover:bg-gray-50 border border-gray-200 rounded-md transition-colors
```

### Form input
```
w-full border border-gray-200 rounded-md px-3 py-2 text-[13px]
focus:border-indigo-300 focus:outline-none transition-colors
```

### Segmented control (view toggles, AI/Manual)
```
inline-flex items-center bg-gray-100 rounded-md p-0.5
  + each segment:
  px-3 py-1 text-[12px] rounded-sm font-medium transition-colors
  active:   bg-white text-gray-900 shadow-sm
  inactive: text-gray-500 hover:text-gray-900
```

### Sidebar nav link
```
flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded-sm
  active:   bg-gray-200/80 text-gray-900 font-medium
  inactive: text-gray-700 hover:bg-gray-200/60 hover:text-gray-900
```

### List row
```
flex items-center gap-4 px-8 py-3 border-b border-gray-200
hover:bg-gray-50 transition-colors
```

### Issue identifier (any place a `<span>` shows COMPA-N or #N)
```
font-display italic text-gray-400 tabular-nums
```

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-08 | Initial design system created via /design-consultation | Brief: "calm, refined, restrained, premium tool" |
| 2026-05-08 | Geist + Instrument Serif over Inter / Space Grotesk | Inter is overused; Space Grotesk is the AI-design-tool convergence trap. Geist has tabular-nums for data tables; Instrument Serif italic on identifiers gives editorial soul. |
| 2026-05-08 | 4-6px radii instead of 8-12 | Sharper edges read more expensive across every reference site we admire (Linear, Stripe, Vercel, Arc). |
| 2026-05-08 | No dark mode | User scope decision. Saves design and engineering effort. |
| 2026-05-08 | Pivot: cream + vermilion + ink, with mineral-blue companion | User brief: "整体淡米色背景加朱红加黑色字体". Replaced midnight-blue accent with 朱红 (#C13524 — the Chinese seal stamp red), warm-stone neutrals with sepia ramp, dark sidebar with light cream sidebar. Added 石青 mineral blue (#2D4F6B) as the classical companion to vermilion (the 朱青 pairing from Song painting) — used on mention chips. |
| 2026-05-08 | Lightened cream after first pass | First cream (#F2EBDC) read too yellow. Dialed to #F8F5EC — the warm hint stays, the saturation drops. |
| 2026-05-13 | **Pivot back: white canvas + zinc grayscale token set** | The cream + vermilion identity was distinctive but felt like a brand exercise rather than a tool — the warm wash made dense tables harder to scan, and the 朱红 accent fought the blue logos most users have on screen all day (Linear / Slack / GitHub). Replaced with a white canvas + zinc grayscale + brand blue (oklch 0.55 0.16 255). Inter for body, Source Serif 4 for display, Geist Mono for code. Tailwind `gray-*` and `indigo-*` aliased to the new tokens so ~350 references upgrade in place. Companion blue is now `--info` (oklch 0.55 0.18 250), used on mention chips. |
