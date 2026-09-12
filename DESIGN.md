---
name: OpenMontage / Backlot
description: A dark editorial production desk with a cream screenplay and a living storyboard.
colors:
  bg: "#0a0a0c"
  surface: "#101013"
  surface-2: "#16161a"
  surface-3: "#1c1c21"
  border: "#232329"
  border-soft: "#1a1a1f"
  text: "#ececef"
  text-2: "#a0a0a9"
  text-3: "#9999a4"
  amber: "#f0a83c"
  amber-dim: "rgba(240, 168, 60, 0.14)"
  green: "#4fc283"
  red: "#e5544b"
  cream: "#f2e9d5"
  cream-shade: "#e5d9be"
  cream-ink: "#29231a"
  cream-ink-2: "#6b5f4a"
typography:
  headline:
    fontFamily: 'Inter, "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "clamp(23px, 2.4vw, 32px)"
    fontWeight: 500
    letterSpacing: "-0.02em"
  title:
    fontFamily: '"JetBrains Mono", "Microsoft YaHei", ui-monospace, monospace'
    fontSize: "calc(17px * 1.16)"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.03em"
  body:
    fontFamily: 'Inter, "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "13px"
    lineHeight: 1.65
  label:
    fontFamily: '"JetBrains Mono", "Microsoft YaHei", ui-monospace, monospace'
    fontSize: "13px"
  screenplay:
    fontFamily: '"Courier Prime", "Microsoft YaHei", "Courier New", monospace'
    fontSize: "15px"
    lineHeight: 1.9
rounded:
  control: "6px"
  media: "7px"
  approval: "8px"
  panel: "12px"
  chip: "99px"
spacing:
  compact: "8px"
  panel-inline: "16px"
  card: "20px"
  section: "24px"
  board-gap: "32px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "#22180a"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
---

# Design System: OpenMontage / Backlot

## Overview

**Creative North Star: "Backlot — Living Storyboard"**

Preserve the original Backlot production desk: a near-black editorial canvas, a warm screenplay page, precise production labels and a horizontal strip of real scene media. The work carries the visual emphasis; controls help creators read, review, confirm and revise it.

This records the current Nimi App implementation in `src/production/backlot-workspace.tsx` and its stylesheet, composed from `backlot/ui/board.css`. Nimi Kit owns platform integration and AIConfig; Backlot owns the production canvas. This is visual guidance, not a release or complete acceptance claim.

**Key Characteristics:**

- Dark tonal surfaces surrounding a cream screenplay.
- Monospaced production metadata beside readable body copy.
- Amber confirmation and active states; green completed states.
- Visible project history, scene media and revision controls.

## Colors

The palette is a quiet dark room with warm paper and purposeful status color. Frontmatter records the current App values, including its more legible `text-3` override.

**Primary:** Amber marks consequential actions, the current stage, waiting for confirmation, selection and keyboard focus. Its translucent companion separates approval and progress notices from the canvas.

**Secondary:** Green identifies completed stages and ready assets; red identifies failures. Status also has text or an icon, so color does not carry the meaning alone.

**Neutral:** The four dark surfaces separate canvas, panels, controls and active navigation. Pale text has two supporting levels. Cream and shaded cream belong to the screenplay; dark ink and softer ink keep its content readable.

**The Status Rule.** Keep amber tied to action or attention and green tied to completion; preserve the explicit state label.

## Typography

Inter supplies body copy and the project-library introduction. JetBrains Mono supplies project titles, stage labels, scene numbers and production metadata. Courier Prime supplies the screenplay. All three families are bundled locally; their stacks include Microsoft YaHei for Chinese text. Bundled weights are Inter 400/600, JetBrains Mono 400/600 and Courier Prime 400/700; intermediate CSS weights use browser font matching.

The library headline is fluid; project titles are compact. Most controls and explanatory copy use 12–14px, while the screenplay body uses the frontmatter role with generous line spacing. Script titles are 20px/700 and scene headings 14px/700. The original board's scaled sizes remain where the App has no explicit override; the frontmatter is a set of observed roles, not a replacement global type scale.

## Layout

The workspace scrolls as a document inside the App shell. A centered container caps at 1440px with 28px desktop gutters. The stage rail precedes local navigation and save status. The board uses a flexible main column and 310px decisions/activity rail, separated by 32px; the screenplay caps at 700px. The project library uses an auto-filling grid with a 290px minimum card width that can shrink to its container.

At 1000px the aside narrows to 270px. The incumbent 900px breakpoint stacks the main board and enables horizontal rail scrolling. At 760px the aside becomes two columns, the toolbar stacks, and editing fields become one column; at 520px the aside stacks and gutters shrink to 12px. Scene cards retain a 252px width and horizontally scroll inside the filmstrip, with 142px media thumbnails. Let long model identifiers wrap rather than widen the board.

## Elevation & Depth

Most surfaces use tonal separation and soft borders. The screenplay uses a warm gradient, a fine page edge and the original diffuse paper shadow. Awaiting approval uses a restrained amber glow on the stage node; media remains clear against dark surroundings. The filmstrip's perforations are part of the incumbent film material language. The App removes the original animated grain and remote font import when scoping the board stylesheet.

Control color transitions take 160ms; library hover lightly lifts the card. Running stages animate to convey progress. Reduced-motion preferences disable animation and transitions within Backlot.

## Shapes

Controls and screenplay use close, gently rounded corners; panels and library cards are more rounded. Media clips to its frame. Pills identify compact metadata, circular nodes locate stages, and the slightly rotated bordered screenplay stamp conveys confirmation status. Keep these forms attached to their existing roles.

## Components

- **Buttons and fields:** Amber primary actions name their result. Dark secondary actions use a fine border. Fields have visible labels, dark surfaces and a cream variant within script editing. Disabled controls fade to 45%; keyboard focus uses a 2px amber outline offset by 4px.
- **Project library:** Real project title, first available image, scene count, date and compact completion rail form each card. A truthful placeholder appears before imagery exists.
- **Stage rail and navigation:** Stages describe production progress; local tabs select the view. Completed checks, waiting text and failure labels accompany color. The current tab uses the raised dark surface.
- **Screenplay:** Centered title and timing metadata lead into numbered scenes, narration and time ranges. Read and edit share the paper. Confirmation has a visible stamp; editing makes the current revision pending.
- **Decisions and activity:** Compact dark panels keep recorded choices and actions beside the work. The last confirmed choices remain visible during revision, with an explicit pending label and expandable history when available. Costs remain unavailable without real source data.
- **Storyboard and review:** A perforated horizontal strip shows scene numbers, image previews, timing, narration and native audio controls. Selection opens the scene editor, image preview and regeneration/reordering controls. Technical job details remain expandable.
- **Results and revisions:** Native video playback leads to export. The separate composition action states that it uses current assets. Empty results direct the creator back to scene review; approval copy explains the next consequential action.

## Do's and Don'ts

- **Do** preserve the near-black desk, cream screenplay, filmstrip and restrained production labels.
- **Do** pair status color with explicit text or icons and retain visible keyboard focus.
- **Do** keep real media, saved decisions and revision state legible at narrow widths.
- **Don't** replace Backlot with a generic platform settings form.
- **Don't** invent cost figures, progress, successful actions or media to fill the interface.
- **Don't** promote unused styles from the original board into App features or acceptance claims.
