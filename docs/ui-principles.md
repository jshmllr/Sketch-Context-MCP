# Accessible, Fast, Delightful UI Principles

This guide consolidates non-negotiable interface rules for Sketch Context MCP and related surfaces. Each rule uses the priority verbs **MUST**, **SHOULD**, or **NEVER** to signal enforcement level. Apply these rules during design critiques, implementation reviews, and regression testing.

## How to Use This Guide

| Verb  | Meaning                                                                 | Compliance                                                                 |
|-------|-------------------------------------------------------------------------|----------------------------------------------------------------------------|
| MUST  | Mandatory requirement. Violations block release until resolved.        | Provide measurable proof (screenshots, audits, test cases) before sign-off. |
| SHOULD| Strong recommendation. Deviations require documented rationale and risk.| Review quarterly to confirm the exception is still valid.                    |
| NEVER | Prohibited practice. Flag immediately and remove from the codebase.    | File a bug and add regression coverage before closing.                      |

### Editorial & Contribution Standards

- Write rules in active voice with a single imperative verb (MUST/SHOULD/NEVER) followed by the desired outcome.
- Group related bullets under the provided subsections. Add new rules only if they fit an existing subsection or justify a new one.
- Keep examples concise. Prefer fenced code blocks for multi-line snippets and inline code for attributes or tags.
- Validate links quarterly; prefer canonical sources (WAI-ARIA APG, MDN, official vendor docs).
- Record every change in the changelog and update the “Last Reviewed” metadata.

> **Last Reviewed:** 2024-05-26

## Quick Reference Overview

- **Interaction Patterns:** Keyboard, inputs, state, feedback, gestures, focus
- **Animation:** Motion preferences, performance-friendly properties, intent
- **Layout:** Alignment, responsiveness, safe areas
- **Content & Accessibility:** Structure, resilience, localization, semantics
- **Performance:** Measurement discipline, rendering hygiene
- **Design:** Visual systems, contrast, polish

---

## 1. Interaction Patterns

### 1.1 Keyboard
- MUST provide full keyboard support that matches the [WAI-ARIA Authoring Practices Guide patterns](https://www.w3.org/WAI/ARIA/apg/patterns/).
- MUST ensure focus indicators are visible using `:focus-visible`; pair with `:focus-within` for composite controls.
- MUST trap, move, and return focus based on the active pattern (e.g., dialogs, menus) before closing transient UI.

### 1.2 Targets & Input
- MUST provide hit targets ≥24px (≥44px on touch). If the visible affordance is smaller, expand the interactive area.
- MUST set mobile `<input>` font-size ≥16px or configure the viewport meta tag:
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
  ```
- NEVER disable browser zoom or gestures that assist accessibility.
- MUST apply `touch-action: manipulation` to interactive elements to prevent double-tap zoom, and match `-webkit-tap-highlight-color` to the design system.

### 1.3 Inputs & Forms
- MUST keep inputs hydration-safe so focus and values persist after renders.
- NEVER block paste in `<input>` or `<textarea>` elements.
- MUST display a spinner on loading buttons while retaining the original label.
- MUST submit the focused text input on Enter. In `<textarea>`, Enter inserts a newline; ⌘/Ctrl+Enter submits.
- MUST keep submit controls enabled until the request starts. Disable them only during the request, show a spinner, and include an idempotency key.
- MUST allow typing without artificial throttles; perform validation after input.
- MUST accept incomplete forms so validation errors surface on submit.
- MUST place error messaging adjacent to fields and shift focus to the first error on submit.
- MUST set `autocomplete`, semantic `name`, accurate `type`, and `inputmode` attributes.
- SHOULD disable spellcheck on emails, confirmation codes, and usernames.
- SHOULD write placeholders with an ellipsis and example pattern (e.g., `+1 (123) 456-7890`, `sk-012345…`).
- MUST warn on unsaved changes before navigating away.
- MUST remain compatible with password managers and two-factor flows; allow pasting one-time codes.
- MUST trim values automatically to remove trailing spaces introduced by text expansion.
- MUST ensure checkbox and radio labels share a generous hit target without dead zones.

### 1.4 State & Navigation
- MUST sync the URL with application state (filters, tabs, pagination, expansion). Prefer helper libraries such as [nuqs](https://nuqs.dev).
- MUST restore scroll position when navigating with browser Back/Forward.
- MUST use semantic links (`<a>` or framework `<Link>`) for navigation and honor Cmd/Ctrl/middle-click behaviors.

### 1.5 Feedback
- SHOULD apply optimistic UI updates, reconcile with responses, and either roll back or offer Undo on failure.
- MUST confirm destructive actions or provide a timed Undo option.
- MUST announce toasts and inline validation with polite `aria-live` regions.
- SHOULD append an ellipsis (`…`) to menu items that open follow-up flows (e.g., “Rename…”).

### 1.6 Touch, Drag & Scroll
- MUST design forgiving gestures with ample targets and clear affordances; avoid precision-only interactions.
- MUST delay the first tooltip within a group and remove delay for subsequent peers.
- MUST apply `overscroll-behavior: contain` to modals and drawers intentionally.
- MUST disable text selection and set `inert` on dragged elements/containers during drag operations.
- MUST ensure any clickable-looking element is interactive; eliminate “dead-looking” zones.

### 1.7 Autofocus
- SHOULD autofocus on desktop when a single primary input exists; avoid autofocus on mobile to prevent layout shifts.

---

## 2. Animation

- MUST honor `prefers-reduced-motion` by providing an equivalent reduced experience.
- SHOULD prefer CSS animations, then the Web Animations API, and use JS libraries only as a last resort.
- MUST animate compositor-friendly properties (`transform`, `opacity`) and avoid layout-triggering properties (`top`, `left`, `width`, `height`).
- SHOULD animate only when clarifying cause/effect or adding deliberate delight.
- SHOULD select easing curves that match the scale and intent of the motion.
- MUST allow animations to be interruptible and respond to user input; avoid autoplay sequences.
- MUST set `transform-origin` so motion starts from the element’s perceived origin.

---

## 3. Layout

- SHOULD apply optical alignment, nudging elements ±1px when visual perception beats mathematical centering.
- MUST align intentionally to grids, baselines, edges, or optical centers; avoid accidental placement.
- SHOULD balance icon-text pairings for stroke, weight, size, spacing, and color harmony.
- MUST validate layouts across mobile, laptop, and ultra-wide viewports (simulate ultra-wide at 50% zoom).
- MUST respect safe areas using `env(safe-area-inset-*)` values.
- MUST prevent unexpected scrollbars by resolving overflow issues.

---

## 4. Content & Accessibility

- SHOULD present inline help before resorting to tooltips.
- MUST ensure skeleton loaders mirror final content to prevent layout shift.
- MUST keep the `<title>` element aligned with the current context.
- MUST avoid dead ends—provide a next step or recovery action in every flow.
- MUST design intentional empty, sparse, dense, and error states.
- SHOULD use curly quotes (“ ”) and avoid widows or orphans in text blocks.
- MUST enable tabular numbers for comparisons using `font-variant-numeric: tabular-nums` or a monospaced alternative such as Geist Mono.
- MUST provide redundant status cues; icons require accessible text labels.
- MUST separate visual minimalism from accessibility: even if labels are hidden, accessible names must exist.
- MUST use the ellipsis character `…` rather than three periods.
- MUST set `scroll-margin-top` on headings, include a “Skip to content” link, and maintain a logical `<h1>`–`<h6>` hierarchy.
- MUST handle user-generated content of varying lengths without breaking layout.
- MUST format dates, times, numbers, and currency according to locale.
- MUST verify accessible names, hide decorative elements with `aria-hidden`, and audit the Accessibility Tree.
- MUST give icon-only buttons descriptive `aria-label` values.
- MUST prefer native semantics (`button`, `a`, `label`, `table`) before introducing ARIA roles.
- SHOULD allow right-clicking the navigation logo to expose brand assets.
- MUST bind key phrases with non-breaking spaces (e.g., `10&nbsp;MB`, `⌘&nbsp;+&nbsp;K`, `Vercel&nbsp;SDK`).

---

## 5. Performance

- SHOULD test critical flows in iOS Low Power Mode and macOS Safari.
- MUST capture performance metrics in controlled environments (disable extensions that skew results).
- MUST monitor and minimize React re-renders using React DevTools or React Scan.
- MUST profile under CPU and network throttling.
- MUST batch layout reads and writes to avoid layout thrashing.
- MUST keep mutations (`POST`, `PATCH`, `DELETE`) under 500 ms.
- SHOULD favor uncontrolled inputs or make controlled input loops inexpensive per keystroke.
- MUST virtualize large lists (e.g., with `virtua`).
- MUST preload only above-the-fold imagery and lazy-load the rest.
- MUST prevent Cumulative Layout Shift by reserving image dimensions or placeholders.

---

## 6. Design System Quality

- SHOULD layer shadows (ambient plus direct) to convey depth.
- SHOULD craft crisp edges with semi-transparent borders and complementary shadows.
- SHOULD maintain nested radius relationships where children ≤ parents and concentric.
- SHOULD align hue shifts across borders, shadows, and text toward the background hue.
- MUST ship accessible charts using color-blind-friendly palettes.
- MUST meet contrast targets—prefer the [APCA contrast model](https://www.myndex.com/APCA/) over WCAG 2 ratios.
- MUST increase contrast on hover, active, and focus states.
- SHOULD match browser UI chrome (scrollbars, form controls) to the page background when themed.
- SHOULD avoid gradient banding; apply dithering or masks when necessary.

---

## Glossary

- **APG**: WAI-ARIA Authoring Practices Guide. Canonical keyboard and interaction patterns for web components.
- **APCA**: Advanced Perceptual Contrast Algorithm—a contrast method better aligned with human perception than WCAG 2.
- **Hydration-Safe Inputs**: Form fields that maintain state during server/client reconciliation.
- **Idempotency Key**: Unique request identifier that prevents duplicated mutations when retried.
- **Polite Live Region**: `aria-live="polite"` region that announces updates without interrupting the user.

## Changelog

| Date       | Change Description                    | Author |
|------------|----------------------------------------|--------|
| 2024-05-26 | Initial consolidation and restructuring | Agent  |
