# Designer automation

## What is authoritative

`ai_component_tree` does not scrape the screen. It exports the project as `.aia`
(`GET /ode/download/project-source/<id>/<name>`), unzips it in the server, and parses the
screen's `.scm`:

```json
{
  "name": "Screen1", "type": "Form", "version": "32", "uuid": "0",
  "properties": { "Title": "Tap Counter" },
  "children": [
    { "name": "LblCount", "type": "Label", "properties": { "Text": "0", "FontSize": "40" } },
    { "name": "BtnTap",   "type": "Button", "properties": { "Text": "Tap" } }
  ]
}
```

The response also carries `liveNames` (from the editor's component database) and a `stale`
flag. If they differ, autosave has not flushed yet — wait a few seconds and re-read.

## Adding a component

`ai_component_add { type, name?, parent? }`

1. Switches to the Designer view.
2. Selects `parent` if given (so the new component nests inside that container).
3. Double-clicks the palette item for `type` — the same code path as a user, so App
   Inventor assigns default properties, a uuid and the next free name.
4. Waits for the component to appear in the editor's component database.
5. Renames it with `ai_component_rename` and verifies both that the new name exists and the
   old one is gone.

If any step fails the call throws; you never get a false "created".

## Removing and renaming

Both use the buttons in the source-structure explorer:

- Select the component by clicking its tree row (`[data-name]`), not the visual mock.
- Click the *enabled* Rename/Delete button (App Inventor keeps one enabled pair for
  components and one disabled pair for screens).
- Fill the dialog. The Rename dialog has **two** text boxes — old name (disabled) and new
  name — so the relay targets the last editable field.
- Verify against the component database.

## Properties

`ai_component_properties` reads the current values from the properties panel.
`ai_component_set_property` writes them.

Supported editors: text input, textarea, number, checkbox, dropdown (`gwt-ListBox`).
Not supported: colour pickers and asset pickers, which open sub-dialogs — set these in the
Designer UI or via the `.scm` if you must automate them.

Property names are exactly the labels shown in the Designer: `Text`, `Width`, `FontSize`,
`Enabled`, `TextAlignment`, `BackgroundColor`, …

Sizing values are the strings App Inventor stores: `Automatic...`, `Fill parent...`, or a
number. In `.scm` they are encoded as `-1` (automatic), `-2` (fill parent) and
`-1000 - percent` (for example `-1050` for 50%).

## Nesting

`parent` works for real containers (`HorizontalArrangement`, `VerticalArrangement`,
`TableArrangement`, `Canvas`, `Screen`). The relay selects the container first, then adds,
so the new component becomes its last child. Verify with `ai_component_tree` — children are
nested in `children`.

## Screens

- `ai_screen_add` creates a screen and verifies it by re-exporting the project.
- `ai_screen_remove` only removes the screen currently open in the Designer. Switching
  screens is not exposed as a clickable control in this App Inventor build, so remove
  screens one at a time by opening each first.

## Blocking dialogs

Any modal `.ode-DialogBox` swallows designer clicks. The relay dismisses stale dialogs
(Dismiss/Close/Cancel/OK) at the start of every designer operation, and `ai_build_apk`
closes the build-result dialog itself.

## Timing

Each designer mutation costs roughly 0.5–2 s (GWT re-render + verification). Batch related
changes in a single agent turn rather than one call per property when latency matters.
