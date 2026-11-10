import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.resolve(process.argv[2] || path.join(project, ".."));
mkdirSync(path.join(project, "public/screenshots"), { recursive: true });
mkdirSync(path.join(project, "public/fonts"), { recursive: true });
for (const file of [
  "03-instances-sakura.png",
  "04-instances-midnight.png",
  "06-mods-modrinth.png",
  "10-health-check.png",
])
  copyFileSync(
    path.join(source, "src/assets/screenshots", file),
    path.join(project, "public/screenshots", file),
  );
copyFileSync(
  path.join(source, "src/assets/logo.png"),
  path.join(project, "public/logo.png"),
);
for (const file of readdirSync(path.join(source, "public/fonts")))
  copyFileSync(
    path.join(source, "public/fonts", file),
    path.join(project, "public/fonts", file),
  );
console.log("Copied real screenshots, logo and licensed website fonts.");
