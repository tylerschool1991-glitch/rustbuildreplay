// Bundles src/ into single-file pages.
//   dist/index.html    – full HTML document, deployable to any static host (Netlify, Cloudflare Pages, GitHub Pages)
//   dist/artifact.html – same page without the <html>/<head> wrapper, for Claude artifact previews
//   docs/index.html    – copy of dist/index.html that GitHub Pages serves
// Usage: node build.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, p), "utf8");

// Order matters: later files use names declared in earlier ones.
const ORDER = ["measured", "core", "world", "models", "fx", "decor", "autoorder", "samples", "viewer", "walk", "builder", "archive", "main"];

const css = read("src/styles.css");
// three.js r128 example modules (MIT), bundled so post-processing doesn't depend on more CDN requests.
const VENDOR = ["SimplexNoise", "CopyShader", "SSAOShader", "LuminosityHighPassShader", "FXAAShader", "EffectComposer", "RenderPass", "ShaderPass", "SSAOPass", "UnrealBloomPass"];
const js =
  VENDOR.map(n => `// ---------- vendor/${n}.js ----------\n` + read(`src/vendor/${n}.js`)).join("\n") + "\n" +
  '(function () {\n"use strict";\n' +
  ORDER.map(n => `// ---------- ${n}.js ----------\n` + read(`src/js/${n}.js`)).join("\n") +
  "\n})();\n";

const tpl = read("src/index.html");
const [headPart, bodyPart] = tpl.split("<!--BODY-->");
if (bodyPart === undefined) throw new Error("src/index.html needs a <!--BODY--> marker");
const fill = s => s.replace("/*CSS*/", () => css).replace("/*JS*/", () => js);

const head = fill(headPart).trim();
const body = fill(bodyPart).trim();

fs.mkdirSync(path.join(here, "dist"), { recursive: true });
fs.writeFileSync(path.join(here, "dist/artifact.html"), head + "\n" + body + "\n");
fs.writeFileSync(
  path.join(here, "dist/index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>
`
);
// GitHub Pages serves the site from /docs on the main branch.
fs.mkdirSync(path.join(here, "docs"), { recursive: true });
fs.copyFileSync(path.join(here, "dist/index.html"), path.join(here, "docs/index.html"));
fs.writeFileSync(path.join(here, "docs/.nojekyll"), "");
console.log("Built dist/index.html, dist/artifact.html and docs/index.html");
