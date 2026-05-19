# Claude / agent instructions for the Agora repo

## Design System

Always read `DESIGN.md` before making any visual or UI decision. All font choices, colors, spacing, border radii, and aesthetic direction are defined there. Do not deviate without explicit user approval.

When in QA mode or doing a design review, flag any code that doesn't match `DESIGN.md`.

Quick checklist:
- Body / UI text: Geist (set globally via `--font-sans`)
- Issue identifiers, large numbers: `font-display italic` (Instrument Serif)
- Code, data: `font-mono` (Geist Mono)
- Accent color: `bg-indigo-600` / `text-indigo-600` (now midnight blue, not internet indigo)
- Neutrals: `gray-*` Tailwind classes (now warm stone, not cold gray)
- Border radius: prefer `rounded` (4px) and `rounded-md` (6px) over `rounded-lg`/`xl`
- Buttons: see `DESIGN.md` "Component recipes" — never use `rounded-full` for buttons
- Dialogs: `rounded-lg` + `border border-gray-200` + `shadow-xl`
- Form inputs: thin `border-gray-200` + `focus:border-indigo-600`, no chunky 2px focus ring

## Other notes

- Tests: `bun run test` runs all packages (server, web, daemon, cli).
- Typecheck: `bun run --filter '*' typecheck`.
- Format/lint: `bunx biome check --write <files>`.
- Dev: `bun run dev` for everything; `bun run dev:web` / `bun run dev:server` individually.
