import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";
void loadFont({
  family: "Nunito",
  url: staticFile("fonts/nunito-cyrillic.woff2"),
  weight: "500 800",
  unicodeRange: "U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
});
void loadFont({
  family: "Nunito",
  url: staticFile("fonts/nunito-latin.woff2"),
  weight: "500 800",
  unicodeRange: "U+0000-00FF,U+2000-206F,U+2191,U+2193",
});
void loadFont({
  family: "Comfortaa",
  url: staticFile("fonts/comfortaa-cyrillic.woff2"),
  weight: "600 700",
  unicodeRange: "U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
});
void loadFont({
  family: "Comfortaa",
  url: staticFile("fonts/comfortaa-latin.woff2"),
  weight: "600 700",
  unicodeRange: "U+0000-00FF,U+2000-206F,U+2191,U+2193",
});
void loadFont({
  family: "Fredoka",
  url: staticFile("fonts/fredoka-latin.woff2"),
  weight: "600 700",
});
