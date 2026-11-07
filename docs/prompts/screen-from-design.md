# Build a screen from a design

The design for `{{screen}}` lives in `{{project}}/design/`.

1. **Read the design.**
   `design/bundle.json` holds screens as Layout IR nodes; `design/assets/` holds the
   exported files. If the bundle is missing but a FigCraft document exists, export it first
   (`file.exportLayers` for assets, `file.saveAs { data: true }` for the document).

2. **Check the project.**
   `ai_project_info` and `ai_screens_list` — confirm which screen you are editing and
   whether the target already exists.

3. **Upload assets.**
   `ai_asset_upload` for every file referenced by the design. Then `ai_assets_list`.
   A component that references a missing asset will fail to build.

4. **Dry run.**
   `ai_layout_plan { spec }`. Read `report.approximated` and `report.unsupported`.
   Expected approximations:
   - gaps become spacer components (App Inventor arrangements have no padding)
   - shadows, gradients, border radius beyond `Shape = rounded` are dropped
   - absolute positioning needs Canvas and is not generated

5. **Apply.**
   `ai_layout_apply { spec, createScreen: true }`. Keep the returned `approximations` — they
   are part of the deliverable, not noise.

6. **Fix the styling drift.**
   `ai_component_properties` per component. Text properties and sizes can be set with
   `ai_component_set_property`; colour/typeface/alignment dropdowns cannot, so list them for
   a manual pass instead of silently leaving them wrong.

7. **Verify the structure.**
   `ai_component_tree` must match the design's hierarchy (container nesting, order, names).

8. **Report fidelity.**
   State plainly how many nodes mapped exactly, how many were approximated, and what is
   missing. Never call a lossy import "done".
