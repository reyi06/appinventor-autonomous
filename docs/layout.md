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

## What the compiler does with this

`ai_layout` (the Layout IR) models containers, alignment, gaps, grids and
`space-between`, then emits exactly the components above — gaps become spacer
labels, `space-between` becomes a fill-parent spacer as the last child. Its
report tells you what it could not express (`approximated`), which is usually a
reminder that App Inventor has no border, shadow or radius outside `Button.Shape`.

`docs/designer.md` covers sizing and colour encoding; this file covers the
arrangements themselves.
