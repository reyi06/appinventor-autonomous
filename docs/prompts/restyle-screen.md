# Restyle an existing screen

Apply the brand tokens in `{{tokens}}` to `{{screen}}` in project `{{project}}`.

1. `ai_project_info` and `ai_status` — confirm you are on the right project and connected.
2. `ai_component_tree { screen: "{{screen}}" }` — inventory every component first.
3. `ai_theme_apply { screen: "{{screen}}", tokens: { ... } }`
   Supported tokens: `color.primary`, `color.background`, `color.text`, `type.body`.
   Colour values accept `#rrggbb`, `#rrggbbaa`, `rgb(r,g,b)` or Figma-style objects.
4. Read the returned `approximations`. Colour properties use a dropdown editor that this
   App Inventor build does not expose to scripted input, so expect them to be listed rather
   than applied. Tell the user exactly which properties still need a manual pass.
5. For anything that *can* be applied programmatically (text, sizes, visibility), prefer
   `ai_component_set_property` with explicit component names.
6. `ai_validate`, then `ai_build_and_test` with the existing scenario to prove the restyle
   broke nothing.

Rules:

- Never restyle by deleting and recreating components — that orphans blocks.
- Never claim a visual change you did not verify on the device.
