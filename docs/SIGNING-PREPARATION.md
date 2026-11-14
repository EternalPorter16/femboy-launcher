# Signing preparation checkpoint — 2026-11-14

## Current source status

The project is preparing for code signing. SignPath Foundation acceptance, a configured signing integration and a signed release have not been confirmed. The current public release must not be described as signed by SignPath.

The GPL-3.0-only LICENSE and manual Windows unsigned build workflow are committed locally. Publishing a reviewed source revision and completing a hosted build remain separate steps. The unsigned workflow does not submit a signing request or publish a release. Its provenance manifest identifies the source, run and file hashes; it is not a cryptographic signature or proof of SignPath origin verification.

## Prepared locally

- Distribution notice hooks preserve project, font and dependency notices and check the packaged Windows payload. Exact supplement hashes protect the reviewed upstream texts.
- checksum, tr46/Unicode and assert-plus notice preservation has been addressed. lazy-val 1.0.5 remains explicitly reviewRequired, so the notice inventory remains complete=false. Its canonical MIT reference is not presented as a recovered upstream copyright notice.
- RU/EN Setup and fresh-profile privacy choices, runtime controls, local policy files and first-run gating are implemented. Optional choices start off for fresh profiles. Existing valid profiles retain settings on normal launch and silent updates; an explicit interactive installation replaces the four corresponding settings.
- The maintainer has confirmed clean installation, reinstall with retained data, silent upgrade behavior and automatic updating on Windows 11. This does not establish every all-users/ACL or negative TLS/checksum scenario.
- The privacy draft and installer notices use the support bot and describe its consent, forwarding, local metadata, cleanup conditions and deletion limits. Provider references distinguish service documentation from verified policy pages.
- The maintainer confirmed GitHub multi-factor authentication. SignPath MFA, account access and signing-role configuration remain unconfirmed.
- Asset provenance records maintainer statements about generated artwork and audio, not an independent rights determination.

## Remaining gates

1. Resolve the lazy-val copyright-notice review and final distribution obligations. Do not mark the notice inventory complete without evidence.
2. Finish the privacy/provider review and publish the policy for the reviewed release. The four optional-feature choices are not a global offline mode; MCHeads display requests and requested catalogs/login/downloads are separate. Disclosure alone does not establish that SignPath's disable-option requirement is met.
3. Publish a reviewed source revision, complete a hosted build, and retain its exact workflow/run/artifact identity. The current unsigned workflow is preparation, not a signing pipeline.
4. Confirm SignPath MFA, actual maintainer/approver roles, account access and Foundation acceptance. The maintainer is a proposed approver; no service-side configuration is inferred.
5. After acceptance, configure supported origin verification, product/version restrictions, upstream-binary exclusions, manual approval, timestamping and the application's nested signing sequence.
6. Verify final signatures, compute hashes and update metadata from final signed bytes, and test both distribution formats and the installed updater transition before publishing.

The real-cloud test using an external sync client on two computers is deferred because a second test computer is unavailable. Local tests and a two-computer model do not replace that integration test. The audit is not represented as complete.

## References

- [SignPath Foundation conditions](https://signpath.org/terms)
- [Application](https://signpath.org/apply)
- [Official integration example](https://github.com/SignPath/demo-github-actions)
- [Privacy draft](PRIVACY-DRAFT.md)
- [Asset provenance](ASSET-PROVENANCE.md)
- [Open upstream lazy-val notice issue](https://github.com/develar/lazy-val/issues/4)

Official terms were reviewed on 2026-11-14. Final acceptance is the Foundation's decision. SmartScreen behavior is not guaranteed by preparation or an eventual signature.
