// Gera as variações da logo do Celuzap (SVG, PNG transparente, ícones, favicon)
// a partir do desenho vetorial abaixo. Uso: node scripts/gerar-logo-celuzap.cjs
const fs = require("node:fs");
const path = require("node:path");
const sharp = require(path.join(process.cwd(), "node_modules/.pnpm/sharp@0.35.4_@types+node@22.20.4/node_modules/sharp"));

const NAVY = "#1A2333";
const pt = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [(cx + r * Math.cos(a)).toFixed(1), (cy + r * Math.sin(a)).toFixed(1)];
};
const C = [513, 512], RO = 118, RI = 66, ABRE = 42;
const [ox1, oy1] = pt(...C, RO, -ABRE), [ox2, oy2] = pt(...C, RO, ABRE);
const [ix1, iy1] = pt(...C, RI, ABRE), [ix2, iy2] = pt(...C, RI, -ABRE);
const letraC =
  `M${ox1} ${oy1} A${RO} ${RO} 0 1 0 ${ox2} ${oy2} L${ix1} ${iy1} A${RI} ${RI} 0 1 1 ${ix2} ${iy2} Z` +
  ` M408 566 L397 645 L478 622 Z`;

const simbolo = `
  <defs>
    <linearGradient id="verde" x1="0.85" y1="0.05" x2="0.1" y2="0.95">
      <stop offset="0" stop-color="#00C853"/><stop offset="0.5" stop-color="#0F9D58"/><stop offset="1" stop-color="#0A6E57"/>
    </linearGradient>
  </defs>
  <rect x="308" y="170" width="408" height="682" rx="66" fill="${NAVY}"/>
  <rect x="326" y="188" width="372" height="646" rx="50" fill="#fff"/>
  <rect x="348" y="212" width="328" height="600" rx="34" fill="url(#verde)"/>
  <path d="M402 188 H622 V214 Q622 252 584 252 H440 Q402 252 402 214 Z" fill="#fff"/>
  <path d="M418 188 H606 V212 Q606 236 582 236 H442 Q418 236 418 212 Z" fill="${NAVY}"/>
  <path d="${letraC}" fill="#fff" fill-rule="evenodd"/>`;

const svgSimbolo = (fundo) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Celuzap">${fundo ?? ""}${simbolo}</svg>`;

const svgIcone = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Celuzap"><rect width="1024" height="1024" rx="224" fill="#0C112A"/><g transform="translate(512 512) scale(1.05) translate(-512 -511)">${simbolo.split(NAVY).join("#33466e")}</g></svg>`;

const svgHorizontal = (texto) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="270 150 1900 722" width="1900" height="722" role="img" aria-label="Celuzap">${simbolo}<text x="760" y="630" font-family="'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif" font-size="330" font-weight="700" fill="${texto}">Celu<tspan fill="#0F9D58">zap</tspan></text></svg>`;

async function png(svg, size, file, fundo) {
  await sharp(Buffer.from(svg)).resize(size, size, { fit: "contain", background: fundo ?? { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(file);
}

(async () => {
  const dir = "public/brand";
  fs.writeFileSync(`${dir}/logo-celuzap.svg`, svgSimbolo());
  fs.writeFileSync(`${dir}/icone-celuzap.svg`, svgIcone);
  fs.writeFileSync(`${dir}/logo-celuzap-horizontal.svg`, svgHorizontal(NAVY));
  fs.writeFileSync(`${dir}/logo-celuzap-horizontal-escuro.svg`, svgHorizontal("#E8E9F3"));
  await png(svgSimbolo(), 1024, `${dir}/logo-celuzap-transparente.png`);
  await png(svgIcone, 512, `${dir}/icone-celuzap-512.png`);
  await png(svgIcone, 1024, `${dir}/icone-celuzap-1024.png`);
  await png(svgIcone, 192, `${dir}/icone-celuzap-192.png`);
  await png(svgIcone, 180, `${dir}/apple-touch-icon.png`);
  await png(svgIcone, 32, `${dir}/favicon-32.png`);
  await png(svgIcone, 48, `${dir}/favicon-48.png`);
  await sharp(Buffer.from(svgHorizontal(NAVY))).resize({ width: 1900 }).png().toFile(`${dir}/logo-celuzap-horizontal.png`);
  fs.copyFileSync(`${dir}/logo-celuzap-transparente.png`, "docs/assets/logo-celuzap-transparente.png");
  fs.copyFileSync(`${dir}/icone-celuzap-512.png`, "docs/assets/icone-celuzap-512.png");
  fs.copyFileSync(`${dir}/icone-celuzap-1024.png`, "docs/assets/icone-celuzap-1024.png");
  fs.copyFileSync(`${dir}/logo-celuzap.svg`, "docs/assets/logo-celuzap.svg");
  console.log("ok");
})();
