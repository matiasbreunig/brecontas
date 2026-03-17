# Brecontas Design System

## Direction: Caderneta

Warm, personal, organized — like a well-kept financial notebook. Not a fintech dashboard, not an enterprise tool. The interface should feel like something you reach for with your morning coffee, not something that demands your attention.

**Who:** Matias, technically strong, logs expenses on the go (mobile, PIX, quick captures), reconciles on Sunday mornings. Needs speed on input, clarity on review.

**Feel:** Caderneta financeira — organized, personal, warm. Control without bureaucracy.

## Color World

Colors come from Brazilian personal finance: the green of Real bills, warm ivory of caderneta pages, the amber of a boleto about to expire, the terracotta of a guarda-dinheiro.

### Palette

- **Primary:** Azul-verde do Real — `oklch(0.47 0.12 168)` (~#1B6B5A). The only accent color. Used for active states, CTAs, and brand marks.
- **Canvas:** Warm cream — `oklch(0.97 0.008 80)`. Background surface. Like aged paper.
- **Card:** Warm white — `oklch(0.993 0.003 80)`. One step above canvas.
- **Foreground:** Warm dark — `oklch(0.20 0.02 55)`. Ink on paper.
- **Muted foreground:** `oklch(0.52 0.015 55)`. Secondary text, metadata.
- **Border:** `oklch(0.89 0.01 80)`. Warm, nearly invisible separation.

### Semantic Colors (unchanged from Tailwind defaults)
- **Income/positive:** emerald-600
- **Expense/negative:** red-600
- **Warning/pending:** amber-600
- **Destructive:** `oklch(0.58 0.20 25)`

### Chart Colors
Warm-tinted, rooted in the caderneta world:
```
#1b6b5a, #d97706, #e05a6b, #2d8a7a, #8b6e4e,
#5a7a4e, #c05050, #3a9688, #b07040, #6b8a5a
```

## Depth Strategy: Borders + Subtle Gradients

- **Primary depth:** 1px borders with warm, low-opacity colors
- **Card elevation:** Gradient overlays at 5% opacity (`from-primary/5`, `from-emerald-500/5`, etc.)
- **No drop shadows** on cards or primary surfaces
- **Shadow-sm** only on exceptional emphasis (rare)

## Surfaces (3 levels)

1. **Canvas** — `--background` — warm cream
2. **Card** — `--card` — warm white, border-separated from canvas
3. **Elevated** — popovers/dropdowns — same as card, border-separated

## Sidebar

- **Light sidebar**, same surface as content canvas
- Separated from content by a 1px `border-r border-sidebar-border`
- Active nav item: `bg-primary/10 text-primary` (tinted, not filled)
- Hover: `bg-sidebar-accent` (subtle warm shift)
- Width: 256px (w-64)

## Typography

- **Sans:** Geist Sans (`--font-geist-sans`)
- **Mono:** Geist Mono (`--font-geist-mono`) — for financial figures
- **Financial values:** Always use `tabular-nums` for decimal alignment
- **Hierarchy:** text-2xl bold (hero numbers) → text-base semibold (card titles) → text-sm medium (items) → text-xs muted (metadata)

## Spacing

- **Base:** 4px (Tailwind default)
- **Micro:** gap-1 (4px) — icon gaps
- **Component:** gap-2 to gap-3 (8-12px) — within cards, buttons
- **Section:** gap-4 to gap-6 (16-24px) — between groups
- **Page:** p-4 md:p-6 (16px mobile, 24px desktop)

## Border Radius

- **Base:** 0.625rem (10px) — `--radius`
- **Inputs/buttons:** rounded-lg (radius-lg = 0.625rem)
- **Cards:** rounded-xl (via card component)
- **Nav items:** rounded-lg
- **Badges:** rounded-4xl (pill)

## Signature: Confidence Trace

When the system infers a field value (parsed from text, matched from history, extracted by OCR, suggested by AI), a quiet colored left border appears — like a margin annotation in a notebook. Each source has its own color:

- **Parsed (regex):** `border-l-primary/60`
- **History:** `border-l-emerald-400`
- **OCR:** `border-l-amber-400`
- **AI:** `border-l-purple-400`

A small sparkle icon appears in the corner. The user can see at a glance what was inferred vs. what they typed. Editing a field removes the annotation — it becomes theirs.

## Dark Mode

- Warm charcoal base — `oklch(0.16 0.008 55)`, not pure black
- Cards slightly lighter — `oklch(0.20 0.008 55)`
- Primary shifts to lighter teal — `oklch(0.62 0.12 168)`
- Borders via `oklch(1 0 0 / 10%)` — white at 10% opacity
- Sidebar slightly darker than content for subtle depth via border

## Component Patterns

### Summary Cards (Dashboard)
```
<Card overflow-hidden>
  <gradient overlay from-[semantic-color]/5>
  <CardHeader> title + icon in tinted bg-[color]/10 container
  <CardContent> hero number (text-2xl bold tabular-nums) + description
```

### Beneficiary Combobox
- cmdk-based search + popover
- Shows "Criar [name]" option when free-text doesn't match existing
- Auto-creates beneficiary on conversion

### InferredField Wrapper
- Wraps any form field
- Shows colored left border + sparkle when source != "user"
- Title attribute with source label + confidence percentage

## Mobile Patterns

- Touch targets: min-h-[44px] min-w-[44px] on all interactive elements
- Hamburger drawer navigation (Sheet side="left")
- ResponsiveDialog: Dialog on desktop, bottom Sheet on mobile
- Horizontal scroll cards on dashboard (snap, hidden scrollbar)
- Collapsible filter panels
- safe-area padding for notched phones
