# Code signing policy — preparation

Femboy Launcher is preparing to apply for free open-source code signing through SignPath Foundation. **The project has not yet been accepted, and the current release is not claimed to be signed by SignPath.**

## Scope

Only official Windows application binaries and installers built from this project's public source revision would be submitted for signing. Third-party components retain their licenses and signing identities. A signature must never be used to imply ownership of upstream software or of Minecraft.

Maintainer and proposed signing approver: [EternalPorter16](https://github.com/EternalPorter16). Account security and signing roles must be confirmed before enabling signing. Every production signing request must receive manual approval.

## Release process to implement after acceptance

1. Build from a reviewed, identified public source revision using an approved automated build process. No release or signing secrets are exposed to untrusted contributions.
2. Sign the application's own executable before packaging it; sign the resulting Setup and Portable executables with a trusted certificate and timestamp. Follow the signing service's supported nested-artifact process.
3. Verify signatures and timestamps, then calculate release sizes and hashes from the **final signed bytes**. Generate update metadata from those same files.
4. Test updating an isolated installation and launching both distribution formats before publishing the identical signed artifacts to the existing distribution channels.

A manual-only unsigned Windows build workflow is prepared locally in `.github/workflows/windows-unsigned.yml`, with exact source/run identifiers and hashes. It has not yet run on GitHub and does not submit files to SignPath. The current local release scripts do not yet implement the signing steps. GitHub Releases currently provides a reserve download channel; it is not itself a code-signing service.

## Prerequisites still under review

- Eligibility of all distributed components, assets, licenses, project functionality and public project reputation under the Foundation's terms.
- Multi-factor authentication, signing-service setup, verified artifact origin, role configuration and manual approval.
- An accurate privacy policy covering the launcher's actual network services and optional integrations. No blanket claim of zero network activity is made.
- Approval by SignPath Foundation. Required attribution and links will be added when their truthful status and required wording are confirmed.

## Changing the signing provider

A later release can use another trusted provider. Before changing publisher identity, test the installed updater's publisher verification and prepare any required transition release. Never disable signature verification to force the transition. SmartScreen reputation is external to the application and is not guaranteed to transfer or disappear immediately.

## References

- [SignPath Foundation conditions](https://signpath.org/terms)
- [Application](https://signpath.org/apply)
- [Official GitHub Actions integration example](https://github.com/SignPath/demo-github-actions)
- [Microsoft: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

## Preparation records

See [current gates](docs/SIGNING-PREPARATION.md), [asset provenance](docs/ASSET-PROVENANCE.md), and the [unpublished privacy draft](docs/PRIVACY-DRAFT.md). These documents do not claim acceptance, a signed release, a completed licensing review, or completed installation/privacy controls.

Distribution license texts are now collected and checked by the Windows packaging hooks. A local unsigned unpacked build preserved the project/font/Electron notices and covered88packaged npm packages. Three legacy packages remain explicitly flagged for notice review. This does not mean that the final legal review or a signing integration is complete.

A local RU/EN installer privacy page and runtime background-update switch are now implemented and tested in isolation. Optional installer choices start unchecked, apply before background services, and are not rewritten by silent updates. Local privacy texts are included and checked in packaging. The draft is not yet public policy, and Portable first-run parity, provider references and licensing review remain incomplete. No claim of SignPath acceptance or signing is made.

Fresh Portable and clean installed profiles without a recorded installer choice now show a separate local RU/EN choice before normal UI/background services. Existing valid profiles keep their settings on normal launch and silent updates (an explicit interactive installer choice replaces the four matching settings); cancellation exits without accepting. Actual unsigned Portable and isolated installed-payload tests cover save/cancel, legacy/corrupt profiles and save retry. This closes the previously missing first-run path locally, not the remaining licensing/installation/provider/hosted-CI/approval/signing work.


## Notice review update — 11 November 2026

Notice preservation now resolves checksum 0.1.1 using its exact upstream copyright header plus explicitly identified canonical MIT terms, and tr46 0.0.3 using the upstream license-only commit immediately following its npm gitHead. Unicode 8.0 data attribution and the official Unicode License V3 are also preserved. Exact package/source and notice hashes guard these supplements. Only lazy-val 1.0.5 remains reviewRequired; its canonical reference is not represented as an author-supplied copyright notice. NOTICE-INVENTORY.json remains complete=false. This is preservation work, not legal approval.
