---
name: OMNI Financial Infrastructure
colors:
  surface: '#fcf8fa'
  surface-dim: '#dcd9db'
  surface-bright: '#fcf8fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f5'
  surface-container: '#f0edef'
  surface-container-high: '#eae7e9'
  surface-container-highest: '#e4e2e4'
  on-surface: '#1b1b1d'
  on-surface-variant: '#45464d'
  inverse-surface: '#303032'
  inverse-on-surface: '#f3f0f2'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#271901'
  on-tertiary-container: '#98805d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#fcf8fa'
  on-background: '#1b1b1d'
  surface-variant: '#e4e2e4'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-md:
    fontFamily: IBM Plex Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  code-sm:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 1440px
  sidebar-width: 260px
  gutter: 1.5rem
  stack-compact: 0.5rem
  stack-default: 1rem
  stack-loose: 2rem
---

## Brand & Style

The design system is engineered for **OMNI**, a Kenyan financial infrastructure platform tailored for developers. The brand personality is rooted in **precision, reliability, and technical authority**. It avoids the superficial trends of consumer fintech, opting instead for a **high-density, professional utility** aesthetic that feels like an essential tool rather than a lifestyle app.

The visual style follows a **Corporate Modern** approach with a lean toward **Developer Tooling**. It prioritizes information hierarchy, legible data tables, and clear system states. The interface communicates "Financial Infrastructure" through structural alignment, restrained color usage, and a focus on transactional accuracy.

Key attributes:
- **Infrastructure-first:** The UI feels like a robust engine—stable and unshakeable.
- **Precision:** Every pixel serves a function; whitespace is used for clarity, not just decoration.
- **Localized Context:** Built for the Kenyan market, with specific attention to KES currency formatting and M-Pesa integration flows.

## Colors

The palette is anchored by a deep **Charcoal Primary** (#0F172A), representing stability and the "backbone" of financial transactions. A functional **Infrastructure Blue** (#2563EB) is used sparingly for primary actions and interactive states.

- **Backgrounds:** A very light gray (#F8FAFC) is used for the page background to differentiate from pure white (#FFFFFF) surface containers (cards and tables).
- **Functional Colors:** 
    - **Success Green:** Specifically tuned for financial growth indicators (e.g., KES balance increases).
    - **Live vs. Sandbox:** Use a distinct visual toggle. Sandbox environments should utilize a diagonal striped border or a subtle violet tint to prevent accidental production actions.
- **Contrast:** High contrast (AA/AAA) is maintained throughout to ensure readability in high-glare environments often found in technical workspaces.

## Typography

Typography is the most critical element of this design system, given the data-heavy nature of financial ledgers.

- **Geist** is used for structural headings, providing a clean, geometric feel that resonates with modern developer tools.
- **Inter** handles the bulk of the UI, chosen for its exceptional legibility in small-scale labels and dense tables.
- **IBM Plex Mono** is strictly reserved for API keys, JSON payloads, transaction hashes, and KES currency values where character alignment is paramount.
- **Formatting:** KES values should always use the `code` font or a tabular-lining version of the UI font to prevent "jumping" text during real-time balance updates.

## Layout & Spacing

This design system utilizes a **Fixed Sidebar + Fluid Content** model for the dashboard. 

- **Grid:** A standard 12-column grid for the main content area, with a fixed 260px sidebar for primary navigation and environment switching.
- **Density:** High information density is preferred. Vertical spacing is tighter than consumer apps to allow more data rows to be visible above the fold. 
- **Data Tables:** Tables are the core of the experience. They should extend the full width of their container with horizontal scrolling reserved only for mobile breakpoints.
- **Responsive:** On mobile, the sidebar collapses into a bottom-sheet or a slide-out drawer, and data tables prioritize the "Amount" and "Status" columns, hiding secondary metadata like "Transaction ID" behind a detail-view click.

## Elevation & Depth

To maintain a "Professional/Technical" atmosphere, this design system avoids heavy shadows and floating layers.

- **Layering:** Use **Tonal Layers**. The page background is at the lowest level, with white "Surfaces" (cards/tables) resting on top. 
- **Outlines:** Surfaces are defined by **Low-contrast Outlines** (1px solid, #E2E8F0) rather than shadows. This creates a "flat-plan" look that feels more precise and technical.
- **Active State Elevation:** Only use a subtle, tight shadow (0px 1px 2px rgba(0,0,0,0.05)) for interactive elements like dropdowns or buttons to indicate they have been "lifted" for the user's attention.
- **Modals:** Overlays use a solid 60% neutral-900 backdrop with no blur to keep the focus sharp and the performance high.

## Shapes

The shape language is **Soft and Structural**. 

- **Corners:** 0.25rem (4px) is the standard for buttons, inputs, and small UI components. This provides a clean, modern look without feeling "bubbly" or overly casual.
- **Containers:** Larger surfaces like cards or modal containers use 0.5rem (8px) to soften the layout slightly while maintaining a professional grid.
- **Iconography:** Use a consistent 1.5px or 2px stroke weight. Avoid filled icons unless indicating an active navigation state.

## Components

### Buttons & Inputs
- **Primary Action:** Solid Charcoal (#0F172A) with white text. High contrast, sharp edges (4px).
- **Inputs:** Use fixed-height containers (36px or 40px). Prefixes for international dialing codes (+254) and currency (KES) should be styled as non-editable grey text blocks inside the field.

### Status Badges
- **Structure:** [Icon] + [Label] + [Subtle Background].
- **Success:** Green stroke, light green tint background (e.g., "COMPLETED").
- **Warning:** Amber stroke, light amber tint background (e.g., "PENDING").
- **Error:** Red stroke, light red tint background (e.g., "FAILED").

### Environment Switcher
- A prominent toggle in the sidebar or top-bar. 
- **Live:** Solid blue indicator. 
- **Sandbox:** High-visibility amber indicator with a "Testing" banner globally visible at the top of the viewport.

### Data Tables
- Header: Sticky, light gray background, all-caps label font.
- Rows: Subtle hover state (#F1F5F9). 
- Numbers: Right-aligned for easy comparison. Use IBM Plex Mono for all currency figures.

### Code Blocks
- Dark theme background (#1E293B) even in the light UI. 
- Includes a "Copy" button in the top right.
- Language label (e.g., cURL, Node.js, Python) in the top left.