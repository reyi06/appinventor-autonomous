# Releasing

The checklist for publishing a version. Everything here is either already green
in CI or a one-line command.

## Before the tag

```bash
npm test                 # 28 protocol + 34 security + 34 layout + 129 corpus
npm run selftest         # against a live editor, if one is attached
git status               # must be clean
```

- [ ] `CHANGELOG.md` has a dated section for the version, with anything breaking called out.
- [ ] `package.json` `version` matches that section (semver: the tool surface changing is a
      **major**, a new action or property is a **minor**, a fix is a **patch**).
- [ ] `docs/mcp-tools.md` lists every action the 13 tools accept.
- [ ] Nothing sensitive in the working tree **or the history**:
      `git log --all -p | Select-String "password|secret|@gmail|\.aia"` — sample projects and
      exported apps must never be committed (they carry the author's account handle).
- [ ] `samples/ui-corpus/*.aia` are gitignored (third-party, no redistribution licence).
- [ ] `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md` are current.

## Tag and publish

```bash
git tag -a v2.1.0 -m "appinventor-autonomous 2.1.0"
git push origin master --follow-tags
gh release create v2.1.0 --generate-notes \
  --title "appinventor-autonomous 2.1.0" \
  "appinventor-autonomous-2.1.0.tgz"
npm publish              # optional: the bin/ wrapper makes `npx appinventor-mcp` work
```

`npm pack` produces the tarball named in `files` (server, extension, docs, bin). CI runs
`npm pack --dry-run` on every push, so a packaging break shows up before the release.

## After publishing

- [ ] Install from the release, not the checkout, and run `ai_status { action: "selftest" }`.
- [ ] Check the README's download commands against the real asset names.
- [ ] Bump `docs/compat.md` if an App Inventor release changed a selector.

## What a release claims

The README status table is the promise. Keep it honest: a capability that reports
`verified: false` or `unsupported` is listed as such, and anything the tooling cannot do
(component extensions, `PrimaryColorDark`, block-level colour literals) is named in
`docs/compat.md` rather than left for a user to discover.
