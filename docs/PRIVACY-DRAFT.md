# Privacy notice — prepared draft for the next release

Prepared: 11 November 2026. Reviewed: 14 November 2026. Scope: Femboy Launcher desktop source currently under review. This revision is not publicly released. A local test Setup now presents privacy information and independent optional-feature choices; the same page code has been exercised in an inert test harness. It is not a statement that the existing public0.10.2 files include the latest source changes, or that SignPath has approved the application. The project website and independent third-party services have separate processing practices.

## Local data and accounts

The launcher stores settings, account identifiers and session material, instance configuration, downloaded content, skins, logs, local play statistics and backups on the computer. The actual data directory is shown in Settings and opened with “Open launcher folder”. Portable mode normally uses a data folder beside the portable executable, but can retain an existing profile directory or fall back when the portable directory is not writable; use the displayed path instead of assuming the location.

Settings/account data are in launcher.json and its backup launcher.json.bak. Minecraft resources, instances and Java can occupy subfolders of the data directory. Game worlds and game/mod logs can contain additional personal data.

Microsoft sign-in uses the provider's authentication window and the msmc library. Ely.by sign-in sends the entered username/password and, when used, a second-factor code to Ely.by. The inspected account record stores a resulting token, not the Ely.by password. Microsoft refresh material and Ely.by tokens are encrypted using Electron safeStorage when operating-system encryption is available. The code has an unencrypted fallback when it is unavailable: do not assume all stored account data are encrypted. The whole settings file, usernames, API key and all backups are not covered by a blanket encryption claim.

Removing an account removes its current launcher record and cached skin. Ely.by removal attempts token invalidation without waiting for confirmation; Microsoft removal does not promise to revoke the provider's remote session. Old records may remain in a settings backup, external backups or copied profiles. Provider-side account/session controls remain separate. Do not publish launcher.json, its backup or unreviewed diagnostic archives.

## Network activity and its controls

The default settings object retains legacy values, but a fresh profile without an installer choice is now gated by a local first-run choice before optional services or the normal UI start. A valid existing profile keeps its settings on normal launch and silent updates; an explicit choice in an interactive installation replaces the four matching settings. Interactive Setup now makes an explicit independent choice, initially off for all four features; this local implementation is not yet in the public release. An installer choice is recorded locally and applied once to each profile; later in-app changes are retained until another interactive installer choice is made.

Every remote service receives ordinary connection information such as the source IP address and requested resource. Some requests identify the launcher/version. Authentication and content providers receive the data necessary for the selected operation; a proxy or mirror changes which systems handle the connection.

| Feature | Information/service | Current behavior and control |
| --- | --- | --- |
| Launcher updates | downloads.femboylauncher.ru; legacy provider configured in the build may be Yandex Disk or GitHub | When enabled, packaged application checks after startup and approximately every two hours. Setup can download/install on quit; Portable reports availability. Disable background launcher updates in Settings to stop scheduled checks and automatic download/install-on-quit. Manual checking remains available and an available version can be downloaded from the website. Existing requests cannot be undone. |
| Mod update hints | Modrinth; mod-file hashes, versions/loaders and content identifiers | Runs when enabled; fresh profiles start with an explicit choice. Disable “Suggest when mod updates are available” in Settings. The check does not itself install mod updates. Manual searches/checks remain separate. |
| Mod readiness hints | Minecraft version metadata and Modrinth; relevant mod identifiers/hashes and target game version | Runs when enabled; fresh profiles start with an explicit choice. Disable “Suggest when mods are ready for a new Minecraft version” in Settings. |
| Discord Rich Presence | Local Discord client, then Discord's own services/settings | Runs when enabled; fresh profiles start with an explicit choice. Can expose instance name, game/loader/version, start time and server address; associated content images may be referenced. Disable “Show game in Discord” or enable “Hide server address”. Hiding the server does not hide all activity fields. |
| Login, profiles and skins | Microsoft/Xbox/Minecraft or Ely.by; selected account/profile data and skin resources | Initiated by login/profile/skin actions and session refresh required for use. Looking up a skin/name can query Mojang and fall back to Ely.by. Offline account selection is not a global network-off mode. |
| Game, Java, loaders, mods and packs | Mojang/Minecraft, Adoptium, Fabric/Quilt/Forge/NeoForge, Modrinth, optionally CurseForge, download/image hosts chosen by the content | Catalogs, versions, compatibility information, requested downloads and icons can be fetched when the interface loads or content is used. Downloads can use the BMCLAPI mirror according to the source setting. “Official source” avoids that configured mirror route; it does not disable authentication/content networking or guarantee that no other provider is used. A CurseForge API key is sent for its API requests. |
| Server and connection checks | Selected server/service, and optional e4mc broker/relay checks | Queries the tested endpoint. An e4mc connection check can contact its broker and send a probe to the selected relay. Opening a world with e4mc lets remote clients connect through a relay; do it only when intending to share the world. |
| Optional synchronization | The folder selected by the user, and any external cloud client managing it | The launcher reads/writes the chosen folder. The external cloud client controls uploading/retention/account processing. Disabling launcher sync does not delete cloud copies or stop another application's independent activity. |

These controls are not currently a single switch for all network activity. Disabling Discord and mod hints does not disable launcher updates, catalogs, authentication or the game. The interactive Setup page initially leaves all four optional features unchecked and applies the selected values once, before background services start, including to an existing profile. Silent updates do not rewrite the choice. Outside this interactive Setup path, existing/default settings still apply; Portable does not consume the install choice file. Fresh Portable profiles and clean installed profiles without an installer choice now show a separate local RU/EN choice window before the normal UI and background services. All four choices start off. Saving persists the choice/language, while closing cancels startup. This window is not shown to valid existing profiles: they keep their settings on normal launch and silent updates, and only an explicit interactive-installer choice replaces the four matching settings. No claim is made that all networking requires a separate explicit click or that current installation behavior fulfills SignPath's conditions.

Interface avatars/default skins may also contact mc-heads.net. Microsoft accounts can be identified there by UUID; other account types use the MHF_Steve fallback. The four background-service choices do not disable these display requests. Main-window spellchecking is disabled in the latest source to avoid Chromium dictionary downloads; this is not a blanket claim about third-party login windows or game components.

## Statistics, logs and sharing

Play statistics and recap images are generated/stored locally by the inspected implementation. Saving/copying an image is separate from sending it. Launcher logs are stored under the displayed data directory's logs folder and are rotated by size (normally the current launcher.log and two earlier files). Game/mod logs have independent behavior and retention. Redaction exists in launcher logging, but does not guarantee that every diagnostic file contains no personal information.

Exporting a modpack/world/diagnostic bundle, sharing a recap, sending a support message or opening an external link can disclose the selected data. Review content and recipient before sharing. This policy does not state a retention period for messages or files submitted to the maintainer or to an independent provider.

Minecraft, mods, Java and chosen servers may perform their own networking and collect data under their own policies. This notice does not promise that installed mods have no telemetry. It also does not guarantee that a local backup or exported pack excludes every secret stored by an arbitrary mod.

## Finding and deleting local data

Use Settings → “Open launcher folder” to identify the directory actually in use. Account removal is available in Accounts; the feature switches above are in Settings. To remove a profile's remaining local data, first stop the game and launcher and preserve worlds/files you want to keep. Only then remove the intended profile data and its backups. Removing the whole data directory also removes its worlds/instances and settings; it is not merely an account logout. The uninstaller is configured to retain application data, so uninstalling the program alone does not guarantee erasure.

Copies in a selected sync folder, cloud trash/history, manual backups, exports, screenshots, operating-system/browser caches and other launchers are separate. Provider-side accounts and sessions must be managed with the provider. No secure-erasure guarantee or automatic deletion from third-party systems is made.

## Provider information and contact

The following are independent providers' own policies, not promises made by this launcher:

- [Microsoft/Xbox/Minecraft](https://www.microsoft.com/en-us/privacy/privacystatement)
- [Modrinth](https://modrinth.com/legal/privacy)
- [Discord](https://discord.com/privacy)
- [Overwolf/CurseForge services](https://legal.overwolf.com/docs/overwolf/platform/platform-privacy-policy/)
- [Yandex](https://yandex.com/legal/confidential/en/)
- [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
- [Adoptium / Eclipse Foundation](https://www.eclipse.org/legal/privacy/)
- [Telegram](https://telegram.org/privacy) for optional support conversations
- [MCHeads website privacy policy](https://mc-heads.net/privacy); API-specific retention was not separately confirmed

Other services are identified by their own documentation: [Ely.by](https://ely.by/), [Fabric](https://fabricmc.net/), [Quilt](https://quiltmc.org/en/), [Forge](https://files.minecraftforge.net/), [NeoForge](https://neoforged.net/), [BMCLAPI](https://bmclapidoc.bangbang93.com/), [e4mc](https://e4mc.link/), [MCHeads](https://mc-heads.net/). These links are service references, not verified applicable privacy policies. No dedicated applicable policy was confirmed for every service in this review; selected CDN/download, server, mod and cloud providers may differ. Do not represent this list as a complete legal review. Provider references are also included in both local installer/first-run policy texts.

Project contact: [@FemboyLauncherSupportBot](https://t.me/FemboyLauncherSupportBot). Support is optional. After consent in the bot, messages and screenshots are delivered through Telegram to a private support group. The bot is hosted on SpaceWeb. Its local state stores chat/message identifiers, links, ticket status/category and delivery receipts, without storing message text or photos. Inactive links and ticket state older than 30 days, and delivery receipts older than 7 days, are removed when the bot next processes a request; without requests they can remain longer. Telegram messages and external backups have separate retention. Use /privacy for details, /stop to stop forwarding and /delete to delete local links; these commands do not delete Telegram message history. Never send account tokens, passwords, API keys, launcher.json, profile archives or unreviewed logs. Contact and third-party policy links are provided for review; no account registration or message was performed by preparing this document.
