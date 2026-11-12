# Signing preparation checkpoint — 2026-11-11

## Current local status

Locally implemented and checked: distribution notice preservation (one explicit legacy notice review still pending: lazy-val 1.0.5), RU/EN interactive Setup choices, in-app background-update controls, local policy files, and first-run gating for fresh Portable/installed profiles without an installer choice. Existing valid profiles retain settings. Fresh profiles wait for a saved choice before the normal UI/background services; cancel exits. Missing/empty policies and save failure do not silently accept a choice. Actual Portable, cancellation, installed payload, legacy profile, corrupt profile and save retry were exercised in isolated folders.

Not complete: the lazy-val historical copyright notice, remaining provider references/legal review, real installed upgrade/all-users/ACL/uninstall coverage, reviewed public revision and hosted CI, owner MFA/roles, Foundation acceptance and actual signing/signed-updater testing. No release or application submission has occurred.

The dated preparation records below are history; earlier statements about missing first-run controls describe their stage, not the current implementation.


## Prepared locally

- GPL-3.0-only project declaration and full root LICENSE, not yet published in the remote repository by this task.
- docs/ASSET-PROVENANCE.md records the maintainer's statements about generated icon/mascot/audio, with hashes of the distributed icon and sound. This is not an independent rights clearance.
- docs/PRIVACY-DRAFT.md describes background checks, mod hashes, Discord activity/server disclosure, login, downloads, optional relays/cloud folders. It is explicitly an unpublished draft.
- .github/workflows/windows-unsigned.yml: manual dispatch on this repository's main branch only, read-only token, immutable pins for three official actions, npm ci, unit tests on Node24/Electron Node, unsigned electron-builder build with --publish never, hash/commit/run provenance and short-lived artifact upload. No release, signing request, deployment, account keys or automatic trigger. Local syntax/configuration checks do not prove a successful hosted build. It has not been committed, pushed or run on GitHub.

This workflow is a preparation build, **not a SignPath signing pipeline**. A JSON manifest is not a cryptographic signature or independent origin verification. Do not feed these unsigned preparation artifacts into the existing local release publisher: that publisher has a separate source-revision format. Configure SignPath's supported origin verification only after acceptance and a reviewed integration.

## Remaining gates

1. Publish the reviewed license and source revision only after the audit work is ready. Establish one clean hosted build from that revision and retain its exact workflow/run/artifact identity.
2. Resolve the remaining lazy-val 1.0.5 copyright review and final distribution obligations. Current notice coverage is 95 installed non-dev entries and 88 packaged dependencies; checksum, tr46/Unicode, assert-plus, Electron/Chromium and root GPL notices are preserved and checked. complete=false remains intentional.
3. Finish provider/legal review and publish the privacy policy for the reviewed release. RU/EN local policies now include provider references, and Setup/first-run present four initially-off choices. An existing profile keeps its settings on normal launch and silent updates; an explicit choice in an interactive installation replaces the four matching settings. MCHeads display requests and requested catalogs/login/downloads remain separate; do not claim all network traffic is optional or that Foundation acceptance is confirmed.
4. Confirm repository and SignPath MFA, actual owner/approver identity, account access and the Foundation's acceptance. The maintainer is proposed as approver; no configuration or account security was inferred from public data.
5. Request approval with truthful project status and reputation. Configure artifact product/version restrictions, upstream-binary exclusions, manual signing approval, timestamp and the Electron/NSIS nested signing sequence only after the service confirms the supported integration. Never state that free signing has already been granted.
6. Compute hashes and update metadata from final signed bytes, test both formats and installed updater transition before release. SmartScreen behavior is not guaranteed by the preparation or eventual signature.

Sources checked on2026-11-11:
- https://signpath.org/terms
- https://signpath.org/apply
- https://github.com/SignPath/demo-github-actions
- Immutable action refs resolved from the official actions/* GitHub API, evidence in the accompanying audit report.

## Distribution notice preservation — 2026-11-11

The local packaging configuration now runs build/third-party-notices.js before packing and build/verify-packaged-notices.js afterwards. The installer/portable payload is configured to include resources/licenses containing the full project GPL text, font notices, combined third-party notices and a machine-readable inventory. Electron/Chromium notices remain at the distribution root and are checked against the installed Electron distribution.

A real unsigned unpacked Windows test build succeeded. Its88shipped package metadata entries matched the95-entry non-dev lockfile inventory; seven type/optional or transitive entries were not packaged. The embedded assert-plus README license is now preserved independently of README exclusion. No additional packaged package metadata was left uncovered by the tested matching rule.

Notice preservation now resolves checksum 0.1.1 using its exact upstream copyright header plus explicitly identified canonical MIT terms, and tr46 0.0.3 using the upstream license-only commit immediately following its npm gitHead. Unicode 8.0 data attribution and the official Unicode License V3 are also preserved. Exact package/source and notice hashes guard these supplements. Only lazy-val 1.0.5 remains reviewRequired; its canonical reference is not represented as an author-supplied copyright notice. NOTICE-INVENTORY.json remains complete=false. This is preservation work, not legal approval. Other versions without notices stop generation. Review final distribution obligations before signing; game downloads/mods are separate.

The hooks support the project's current Windows ASAR packaging only. No signed build, NSIS/Portable packaging or runtime launch was validated by the unpacked build test. Privacy/installer controls, public reviewed commit, hosted CI, owner MFA and SignPath acceptance remain open.

## Privacy documentation review — 2026-11-11

The prepared privacy draft has been checked against source, including14recorded source assertions. It now states conditional safeStorage encryption/plain fallback; possible old account records in launcher.json.bak; the limits of account removal and remote revocation; actual data-folder/Portable fallback; retained data on uninstall; scheduled launcher updates without a dedicated disable switch; Discord fields; mod hashes; catalogs/mirrors/relays and cloud-folder behavior. Published project contact and six reviewed primary provider-policy links are included. Remaining unverified provider references are explicit; guessed URLs are not presented as verified.

This does not implement installer presentation or pre-launch controls. A single “no networking” claim would be false. Before enabling production signing, implement and verify installer choices/background-update controls with a fresh isolated profile and an actual request trace; preserve manual updating and signature verification. Runtime tests were not repeated for a document-only change. The draft is not published and does not claim legal or Foundation approval.

## Installer and runtime controls — 2026-11-11

Implemented locally: an interactive RU/EN NSIS page with a locally bundled privacy text and four independent choices, initially unchecked (scheduled launcher updates, Discord RPC, mod update hints, mod readiness). It writes a strictly validated choice record, applied once before window creation/updater/Discord/mod background services. A subsequent interactive installation replaces the corresponding settings; silent mode does not rewrite the record. Existing accounts/worlds and unrelated settings are preserved. Portable explicitly does not consume that installation record; it still needs an equivalent first-run review before claiming parity.

The launcher has an in-app scheduled-update switch and local privacy information button. Disabling the switch stops future scheduled checks, automatic downloading and installation on quit; manual checks remain available and can offer the website download. Current in-flight requests cannot be undone. Turning the option back on recreates one schedule. Existing signature/integrity checks were not disabled.

Real NSIS compilation, an inert native RU/EN page, all16serialized combinations, silent-record preservation and a packaged startup on an isolated profile were checked. Chromium dictionary downloads discovered during the first startup trace were disabled for the main window; the remaining mc-heads display request is disclosed separately. These four choices are not a global offline mode. This is not public deployment or proof of full Foundation eligibility;3legacy notices, other provider references, Portable first-run parity, hosted CI/roles/approval and final signed release/update testing remain open.
