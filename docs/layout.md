# Layout

App Inventor's layout components look like a box model. They are not: there is
no padding, no margin, no gap and no flex. Everything is an arrangement that
stacks its children, positioned by a 3×3 alignment grid. Getting this wrong is
what produces screens that look ad-hoc.

All of this was read from the live Designer (property rows) and from
`mit-cml/appinventor-sources`; the alignment codes come from
`ComponentConstants.GRAVITY_*`.

## The six layout components

| Component | Use |
| --- | --- |
| `VerticalArrangement` | stacks children top to bottom (the default column) |
| `HorizontalArrangement` | places children left to right (a row, a header) |
| `VerticalScrollArrangement` | a column that scrolls — prefer this over `Screen.Scrollable` |
| `HorizontalScrollArrangement` | a row that scrolls (chips, carousels) |
| `TableArrangement` | fixed rows × columns; children fill row by row |
| `AbsoluteArrangement` | exact x/y/width/height — not responsive, last resort |

## What a `VerticalArrangement` actually exposes

Seven properties:

```
AlignHorizontal   left | right | center
AlignVertical     top  | center | bottom
BackgroundColor   any colour
Height            pixels | % | Fill parent | Automatic
Width             pixels | % | Fill parent | Automatic
Image             a background image
Visible           true | false
```

That is the whole box model. `AlignHorizontal`/`AlignVertical` position the
*children inside the arrangement*, so they are how you centre a block vertically,
pin a row to the right edge, or spread a header.

## Rules that matter

**Alignment codes are not the same on both axes.**

| Property | 1 | 2 | 3 |
| --- | --- | --- | --- |
| `AlignHorizontal` | left | right | center |
| `AlignVertical` | top | center | bottom |
| `TextAlignment` (Label, TextBox) | left | center | right |

**`Fill parent` only works on the last child.** A fill-parent child in the middle
of a column contributes nothing — it silently collapses. If you need a spacer,
it must be the final child, and it will absorb the leftover space *below* the
content.

**Percentages are relative to the screen, not the parent** (MIT's Responsive
Design guide). `88%` inside a nested arrangement is still 88% of the device
width. Use one column width per screen and keep every full-width element on it —
a card at 88% next to a button at 92% is the most common way a screen looks
"almost right".

**Spacing is structure.** There is no gap or padding property, so vertical space
comes from one of:

- an empty `Label` with a fixed height (`Text` = `""`, `Height` = `12`), which is
  what the layout compiler emits for a `gap`;
- nested arrangements;
- a fixed-height container.

Name these spacers (`GapA`, `GapB`) instead of leaving `Label1`, `Label2` — the
component tree is the only documentation of the layout, and a screen with ten
anonymous labels is unmaintainable.

**Scroll the arrangement, not the screen.** `Screen.Scrollable` is a property of
the whole form and interacts with the action bar; `VerticalScrollArrangement`
scopes the behaviour to one column.

## A column that behaves

```
Screen (AlignHorizontal = center)
└ VerticalArrangement  Root      Fill parent × Fill parent, AlignVertical = center
  └ VerticalArrangement Card     88% × Automatic, BackgroundColor = #FFFFFF
    ├ Label  NameCaption         Fill parent
    ├ TextBox NameBox            Fill parent, Height 48
    ├ Label  GapC                "" , Height 12
    ├ Spinner LevelSpinner       Fill parent, Height 48
    └ HorizontalArrangement Row  Fill parent, Automatic
      ├ Switch   HintsSwitch
      └ CheckBox TimerCheck
  └ Button StartButton           88% × 52
```

- one width rule (88%) for the card, the CTA and the footer label;
- the column centres as a block via `Root.AlignVertical = center`;
- the row of controls keeps its own alignment and does not inherit the column's.

## Chrome as assets: what works, what doesn't

App Inventor cannot draw a radius, a shadow or a gradient, but
`Screen.BackgroundImage`, `Arrangement.Image` and `Button.Image` exist, so design
tools (FigCraft, Figma, Penpot) can supply the parts the platform can't. This was
tested end to end on `samples/quiz/` — see `samples/quiz/chrome.figcraft` and
`samples/quiz/assets/`.

| Surface | Verdict |
| --- | --- |
| `Screen.BackgroundImage` | **works** — a gradient or texture behind everything, content-free by definition |
| `Arrangement.Image` on an empty or pure-decoration container | works |
| `Arrangement.Image` on a container that also holds widgets | **fights the content** — see below |
| `Button.BackgroundImage` | **does not exist.** A `Button` exposes `Image` (an icon above the label) and `Shape`, nothing else |
| Icons via `Image` / `Button.Image` | works, and is the cheapest real win |

### Why a card image fights its content

The bitmap is stretched to the arrangement's box and the widgets are laid out
from that box's origin. So:

- art with a shadow margin draws the white card *inset*, while the first label
  sits at the very top of the box — above the card;
- making the art edge-to-edge fixes that, but then the labels touch the rounded
  corners;
- insetting the children instead (`Width: 90%` + `AlignHorizontal: center`) works
  in principle, but every child needs the rule, and one missed child clips.

The clean way to have both art and widgets is to stop using the arrangement as a
card: put the art in an `AbsoluteArrangement` as one layer and the widgets in a
second, since that is the only place App Inventor stacks layers.

### Asset swaps are cached

Replacing `card.png` and pressing *Refresh Companion Screen* keeps showing the
old bitmap. Only restarting the Companion (or rebuilding the APK) re-fetches it,
which makes iterating on artwork slower than iterating on layout.

### Practical recipe

1. Design the **content-free** chrome: screen background/gradient, header band,
   dividers, icon glyphs, illustrations.
2. Export PNG at the target dp × the device density (`file.export` with
   `size: {by: "scale", value: 3}` for xxhdpi), into the repo, then
   `ai_asset { action: "upload" }`.
3. Reload the editor tab before picking the asset in any dropdown — the asset
   list is cached in the client.
4. Keep containers flat-coloured; put radius and shadow on art that has no
   children.

`samples/quiz/make-logo.mjs` shows the same idea without a design tool: a PNG
generated in code, uploaded, and used by an `Image`.

## What the compiler does with this

`ai_layout` (the Layout IR) models containers, alignment, gaps, grids and
`space-between`, then emits exactly the components above — gaps become spacer
labels, `space-between` becomes a fill-parent spacer as the last child. Its
report tells you what it could not express (`approximated`), which is usually a
reminder that App Inventor has no border, shadow or radius outside `Button.Shape`.

`docs/designer.md` covers sizing and colour encoding; this file covers the
arrangements themselves.

## What a real project does

Read from a production App Inventor app (6 screens, 1.6 MB, fluent layout): its idioms are worth
copying because they solve the exact problems this file describes.

**Chrome is an image on an outer arrangement, content lives in an inner transparent one.**

```
HorizontalArrangement FldName     Height 52, Image = field.png     <- the pill
└ HorizontalArrangement Inner     Width 250 (or a %, transparent)  <- the padded box
  └ TextBox NameBox              BackgroundColor = &H00FFFFFF      <- invisible field
```

`&H00FFFFFF` (alpha 00) is the workhorse: text boxes, buttons and arrangements all go transparent so
the art beneath shows through. Their card rows do the same at 85 px with `Image=Rectangle1.png`.

**The inset must be a length, not a percentage.** Percentages resolve against the screen, so `92%`
inside a 317 dp field is 331 dp and overflows it — which clips the first character and lets a
transparent `Spinner` paint its black rectangle past the pill. A fixed dp width (or `Fill parent`
inside something already padded) is what keeps the inset honest.

**A navbar is `Image` + `Label`, not buttons.** Each tab is a `VerticalArrangement` in a horizontal
row, holding an icon (40×40) and an uppercase 10–12 px label. `Image` has a **`Click`** event, so the
icon is the hit target — no `Button.Image` scaling problem, and the label can wrap with a `\n`.

**Draw your own header.** Every form is `TitleVisible=False`, with a `HorizontalArrangement` at the
top of the body holding a back button (70 px, transparent, `"<"` at 35 px) and a 24 px title.

**Space-between without spacers.** An empty `Width=Fill parent` arrangement between two items absorbs
the slack inside a *horizontal* row — fill-parent splits leftover space among a row's children,
whereas a vertical column only gives it to the last child.

**Ship tokens, not decisions.** A four-colour palette (cream/green/sage/clay), font sizes 9/12/13/
15/16/24/36, bold for emphasis, and two custom `.ttf` files in `assets/`. Nothing is ad-hoc.

The QuizMaster sample applies the navbar and field idioms; its card is still a flat colour.
