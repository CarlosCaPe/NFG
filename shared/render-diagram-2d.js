#!/usr/bin/env node
/**
 * 2D Diagrams v5 — Miro-ready SVG with embedded vendor logos
 *
 * v5 critical fixes (from v4 code review — 2026-03-25):
 *   1. LOGOS: Fetched from cdn.simpleicons.org at build time → embedded as base64
 *      data URIs. v4 used <image href="CDN URL"> which rendered as gray placeholders.
 *   2. LAYOUT: Absolute pixel positions with pre-render overlap validation.
 *   3. CARDS: 100px tall, 40×40 logos, 32px minimum gaps.
 *   4. DISTRIBUTION: space-evenly fills swimlane height (no 40% empty bottom).
 *   5. AUTH BADGES: Inside card body (top-right), not floating overlays.
 *   6. FLOW: Canvas 1300px tall, auth frame separated from consumers by 20px+.
 *   7. ZERO TRUNCATION: All subtitles fully readable, auth cards wide enough.
 *
 * Usage:  node shared/render-diagram-2d.js [--png]
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'clients', 'oncohealth', 'tickets', '186438-iceberg-rest-catalog');
const RENDER_PNG = process.argv.includes('--png');

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════════════
const T = {
  bg:            '#0F1318',
  swimlaneBg:    ['#1A1520', '#1A1D24', '#1A2024', '#1A2418'],
  swimlaneHd:    ['#C62828', '#E65100', '#1565C0', '#2E7D32'],
  border:        '#2A3040',
  textPrimary:   '#ECEFF1',
  textSecondary: '#90A4AE',
  textMuted:     '#546E7A',
  dataArrow:     '#42A5F5',
  authArrow:     '#78909C',
  font:          "'Segoe UI','Inter','Helvetica Neue',system-ui,sans-serif",
};

// Card color palettes per technology
const C = {
  mssql:     { fill: '#1E1E1E', stroke: '#CC2927', text: '#FFCDD2', tag: '#EF9A9A', accent: '#CC2927' },
  ingestion: { fill: '#1A2332', stroke: '#0078D4', text: '#B3D7FF', tag: '#80BFFF', accent: '#0078D4' },
  bronze:    { fill: '#2A1F14', stroke: '#CD7F32', text: '#E8D5B7', tag: '#CD7F32', accent: '#CD7F32' },
  silver:    { fill: '#1E2428', stroke: '#A8B5C0', text: '#CFD8DC', tag: '#B0BEC5', accent: '#C0C0C0' },
  gold:      { fill: '#2A2410', stroke: '#DAA520', text: '#FFF3C4', tag: '#FFD700', accent: '#FFD700' },
  delta:     { fill: '#0E2232', stroke: '#00ADD8', text: '#B2EBF2', tag: '#80DEEA', accent: '#00ADD8' },
  uniform:   { fill: '#0A2A2E', stroke: '#00ACC1', text: '#B2EBF2', tag: '#80DEEA', accent: '#00BCD4' },
  api:       { fill: '#0D1A30', stroke: '#4E8EE9', text: '#BBDEFB', tag: '#90CAF9', accent: '#4E8EE9' },
  auth:      { fill: '#161830', stroke: '#5C6BC0', text: '#C5CAE9', tag: '#9FA8DA', accent: '#5C6BC0' },
  spark:     { fill: '#2A1008', stroke: '#E25A1C', text: '#FFCCBC', tag: '#FFAB91', accent: '#E25A1C' },
  pyiceberg: { fill: '#1A0A2E', stroke: '#BA68C8', text: '#E1BEE7', tag: '#CE93D8', accent: '#9C27B0' },
  snowflake: { fill: '#0A1E2C', stroke: '#29B5E8', text: '#B3E5FC', tag: '#81D4FA', accent: '#29B5E8' },
  trino:     { fill: '#200A1A', stroke: '#DD00A1', text: '#F8BBD0', tag: '#F48FB1', accent: '#DD00A1' },
  duckdb:    { fill: '#2A2410', stroke: '#FFC107', text: '#FFF9C4', tag: '#FFF176', accent: '#FFC107' },
};

// ═══════════════════════════════════════════════════════════════════════════
// LOGO LOADING — reads shared/logos/*.svg at build time, embeds as data URIs
// ═══════════════════════════════════════════════════════════════════════════
const LOGOS_DIR = path.join(__dirname, 'logos');

// Map: our logoKey → { file, bg (badge background), fill (icon fill) }
// simple-icons SVGs are monochrome <path> with no fill — we add fill + bg rect
// Fluent UI SVGs have fill="none" on paths — we replace with white
const LOGO_MAP = {
  mssql:      { file: 'database.svg',     bg: '#CC2927', fill: '#fff', type: 'fluent' },
  azure:      { file: 'azure.svg',        bg: '#0078D4', fill: '#fff', type: 'fluent' },
  databricks: { file: 'databricks.svg',   bg: '#FF3621', fill: '#fff', type: 'simple' },
  delta:      { file: 'delta.svg',        bg: '#00ADD4', fill: '#fff', type: 'simple' },
  iceberg:    { file: 'iceberg.png',      bg: '#1e3a5f', fill: null,   type: 'png' },
  spark:      { file: 'apachespark.svg',  bg: '#E25A1C', fill: '#fff', type: 'simple' },
  python:     { file: 'python.svg',       bg: '#3776AB', fill: '#FFD43B', type: 'simple' },
  snowflake:  { file: 'snowflake.svg',    bg: '#29B5E8', fill: '#fff', type: 'simple' },
  trino:      { file: 'trino.svg',        bg: '#DD00A1', fill: '#fff', type: 'simple' },
  duckdb:     { file: 'duckdb.svg',       bg: '#FFF000', fill: '#000',  type: 'simple' },
  entra:      { file: 'person.svg',       bg: '#0078D4', fill: '#fff', type: 'fluent' },
  pat:        { file: 'key.svg',          bg: '#1a3a6e', fill: '#fff', type: 'fluent' },
  sas:        { file: 'shield.svg',       bg: '#0050a0', fill: '#fff', type: 'fluent' },
};

let EMBEDDED = {}; // base64 data URIs keyed by logo name

function wrapInBadge(innerSvg, bg, iconFill, size) {
  // Wraps a 24×24 viewBox icon inside a size×size rounded badge with background
  // Scales the icon and centers it with padding
  const pad = Math.round(size * 0.15);  // 15% padding
  const iconSize = size - pad * 2;
  const scale = iconSize / 24;

  let processedInner = innerSvg;
  // Remove outer <svg> wrapper, keep only the paths
  processedInner = processedInner
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .replace(/<title>[^<]*<\/title>/, '');

  // For simple-icons: paths have no fill, add it
  if (iconFill) {
    // Replace fill="none" with the icon fill color
    processedInner = processedInner.replace(/fill="none"/g, `fill="${iconFill}"`);
    // For paths with no fill attribute, add one
    processedInner = processedInner.replace(/<path(?![^>]*fill=)/g, `<path fill="${iconFill}"`);
  }

  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="${bg}"/>`
    + `<g transform="translate(${pad},${pad}) scale(${scale.toFixed(4)})">${processedInner}</g>`
    + `</svg>`;
}

function loadAllLogos() {
  console.log('  📥 Loading logos from shared/logos/ ...');
  let ok = 0, fail = 0;

  for (const [key, cfg] of Object.entries(LOGO_MAP)) {
    const filePath = path.join(LOGOS_DIR, cfg.file);
    if (!fs.existsSync(filePath)) {
      console.log(`    ✗ ${key} — file not found: ${cfg.file}`);
      fail++;
      continue;
    }

    if (cfg.type === 'png') {
      // PNG: read as binary, embed as image/png data URI
      const buf = fs.readFileSync(filePath);
      EMBEDDED[key] = `data:image/png;base64,${buf.toString('base64')}`;
      console.log(`    ✓ ${key} (PNG ${(buf.length / 1024).toFixed(1)} KB)`);
    } else if (cfg.type === 'multicolor') {
      // Multi-color SVG (DuckDB): wrap with background, keep original colors
      const raw = fs.readFileSync(filePath, 'utf-8');
      const wrapped = wrapInBadge(raw, cfg.bg, null, 36);
      EMBEDDED[key] = `data:image/svg+xml;base64,${Buffer.from(wrapped).toString('base64')}`;
      console.log(`    ✓ ${key} (multicolor SVG)`);
    } else {
      // simple-icons or fluent: wrap with colored badge
      const raw = fs.readFileSync(filePath, 'utf-8');
      const wrapped = wrapInBadge(raw, cfg.bg, cfg.fill, 36);
      EMBEDDED[key] = `data:image/svg+xml;base64,${Buffer.from(wrapped).toString('base64')}`;
      console.log(`    ✓ ${key} (${cfg.type} → badge)`);
    }
    ok++;
  }
  console.log(`  📦 Embedded ${ok}/${ok + fail} logos as data URIs\n`);
  if (fail) console.warn(`  ⚠️  ${fail} logos missing — run download script first`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYOUT VALIDATION — pre-render overlap check
// ═══════════════════════════════════════════════════════════════════════════
function checkOverlap(rects) {
  const errs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        errs.push(`"${a.id}" (${a.x},${a.y},${a.w},${a.h}) ∩ "${b.id}" (${b.x},${b.y},${b.w},${b.h})`);
      }
    }
  }
  return errs;
}

/** space-evenly: equal gap above, between, and below nodes */
function distributeEvenly(startY, availH, count, nodeH) {
  const gap = (availH - count * nodeH) / (count + 1);
  return Array.from({ length: count }, (_, i) =>
    Math.round(startY + gap * (i + 1) + nodeH * i)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** Wrap text into lines that fit within maxPx width. Estimates ~7.5px per char at font-size 13. */
function wrapText(text, maxPx, charWidth) {
  charWidth = charWidth || 7.5;
  const maxChars = Math.floor(maxPx / charWidth);
  if (text.length <= maxChars) return [text];
  // Split on spaces first; for tokens longer than maxChars, split on / or ·
  const rawWords = text.split(/\s+/);
  const words = [];
  for (const w of rawWords) {
    if (w.length <= maxChars) { words.push(w); continue; }
    // Break long tokens (e.g. URLs) at / keeping the delimiter at end of first part
    const parts = w.split(/(?<=\/)/);
    let chunk = '';
    for (const p of parts) {
      if ((chunk + p).length > maxChars && chunk) { words.push(chunk); chunk = p; }
      else { chunk += p; }
    }
    if (chunk) words.push(chunk);
  }
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (test.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function nodeBox(x, y, w, h, colors, logoKey, name, subtitle, tag, badge) {
  const rx = 8;
  let svg = '';

  // Shadow + card
  svg += `<rect x="${x + 2}" y="${y + 3}" width="${w}" height="${h}" rx="${rx}" fill="#000" opacity="0.2"/>`;
  svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.8"/>`;
  svg += `<rect x="${x}" y="${y + 4}" width="4" height="${h - 8}" rx="2" fill="${colors.accent || colors.stroke}" opacity="0.9"/>`;

  // Logo (40×40 embedded data URI) or colored fallback
  const logoSize = 40;
  const logoX = x + 12;
  const logoY = y + (h - logoSize) / 2;
  const dataUri = logoKey ? EMBEDDED[logoKey] : null;
  let hasLogo = false;

  if (dataUri) {
    svg += `<image href="${dataUri}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}"/>`;
    hasLogo = true;
  } else if (logoKey) {
    // Branded fallback — colored rect with abbreviation (NOT gray placeholder)
    svg += `<rect x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" rx="6" fill="${colors.accent}" opacity="0.7"/>`;
    svg += `<text x="${logoX + logoSize / 2}" y="${logoY + logoSize / 2 + 5}" text-anchor="middle" font-family="${T.font}" font-size="13" font-weight="700" fill="#fff">${esc(logoKey.slice(0, 3).toUpperCase())}</text>`;
    hasLogo = true;
  }

  // Text — positioned right of logo, or left-aligned if no logo
  const textX = hasLogo ? logoX + logoSize + 10 : x + 14;
  const rightPad = 8; // padding before card right edge
  const availTextW = w - (textX - x) - rightPad;

  // Subtitle: word-wrap into multiple lines (font-size 13, ~7.5px/char)
  const subLines = subtitle ? wrapText(subtitle, availTextW, 7.5) : [];
  const lineH = 15; // line height for subtitle

  // Vertically center the text block (name + subtitle lines) within the card
  const textBlockH = 16 + (subLines.length ? 4 + subLines.length * lineH : 0); // name(16) + gap(4) + lines
  const nameY = y + Math.max(20, Math.round((h - textBlockH) / 2) + 14);

  svg += `<text x="${textX}" y="${nameY}" font-family="${T.font}" font-size="16" font-weight="600" fill="${colors.text}">${esc(name)}</text>`;

  for (let li = 0; li < subLines.length; li++) {
    svg += `<text x="${textX}" y="${nameY + 18 + li * lineH}" font-family="${T.font}" font-size="13" fill="${T.textSecondary}">${esc(subLines[li])}</text>`;
  }

  // Tag badge (bottom-right inside card)
  if (tag) {
    const tagW = tag.length * 6.5 + 12;
    const tagX = x + w - tagW - 8;
    const tagY = y + h - 26;
    svg += `<rect x="${tagX}" y="${tagY}" width="${tagW}" height="16" rx="4" fill="${colors.stroke}" opacity="0.6"/>`;
    svg += `<text x="${tagX + tagW / 2}" y="${tagY + 11}" text-anchor="middle" font-family="${T.font}" font-size="10" font-weight="700" fill="${colors.tag}" letter-spacing="0.5">${esc(tag)}</text>`;
  }

  // Environment badge (top-right INSIDE card, not floating)
  if (badge) {
    const bW = badge.label.length * 6 + 14;
    const bX = x + w - bW - 8;
    const bY = y + 6;
    svg += `<rect x="${bX}" y="${bY}" width="${bW}" height="16" rx="3" fill="${badge.bg}"/>`;
    svg += `<text x="${bX + bW / 2}" y="${bY + 11}" text-anchor="middle" font-family="${T.font}" font-size="9" font-weight="700" fill="${badge.color}" letter-spacing="0.5">${esc(badge.label)}</text>`;
  }

  return svg;
}

function dataArrow(x1, y1, x2, y2, label) {
  let svg = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${T.dataArrow}" stroke-width="2.5" marker-end="url(#arrowBlue)"/>`;
  if (label) {
    const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2 - 8;
    svg += arrowLabel(lx, ly, label, T.dataArrow);
  }
  return svg;
}

function authArrow(x1, y1, x2, y2, label) {
  let svg = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${T.authArrow}" stroke-width="1.8" stroke-dasharray="8 4" marker-end="url(#arrowGray)"/>`;
  if (label) {
    const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2 - 8;
    svg += arrowLabel(lx, ly, label, T.authArrow);
  }
  return svg;
}

function arrowLabel(x, y, text, color) {
  const w = text.length * 6.5 + 16;
  let svg = `<rect x="${x - w / 2}" y="${y - 9}" width="${w}" height="18" rx="5" fill="#000000AA" stroke="${color}" stroke-width="0.6"/>`;
  svg += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-family="${T.font}" font-size="12" font-weight="500" fill="#fff">${esc(text)}</text>`;
  return svg;
}

function swimlaneHeader(x, y, width, color, label, number) {
  let svg = `<rect x="${x}" y="${y}" width="${width}" height="34" rx="6" fill="${color}"/>`;
  svg += `<text x="${x + 14}" y="${y + 22}" font-family="${T.font}" font-size="15" font-weight="700" fill="#fff" letter-spacing="0.8">${number}  ${esc(label)}</text>`;
  return svg;
}

function sectionFrame(x, y, w, h, label, borderColor) {
  borderColor = borderColor || T.border;
  let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" stroke="${borderColor}" stroke-width="1" stroke-dasharray="6 3" opacity="0.5"/>`;
  if (label) {
    // Label sits ON the top border with a background mask to erase the dashed line behind it
    const labelW = label.length * 6.5 + 16;
    svg += `<rect x="${x + 6}" y="${y - 8}" width="${labelW}" height="16" rx="3" fill="${T.bg}"/>`;
    svg += `<text x="${x + 14}" y="${y + 4}" font-family="${T.font}" font-size="11" font-weight="600" fill="${T.textMuted}" letter-spacing="0.5">${esc(label)}</text>`;
  }
  return svg;
}

function svgDefs() {
  return `<defs>
    <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="0.5" fill="#1E2830"/></pattern>
    <marker id="arrowBlue" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><polygon points="0 0,10 4,0 8" fill="${T.dataArrow}"/></marker>
    <marker id="arrowGray" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><polygon points="0 0,10 4,0 8" fill="${T.authArrow}"/></marker>
  </defs>`;
}

function legendBlock(lx, ly, lw) {
  const lh = 96;
  let svg = `<rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="8" fill="#111620" stroke="${T.border}" stroke-width="1"/>`;
  svg += `<text x="${lx + 14}" y="${ly + 18}" font-family="${T.font}" font-size="13" font-weight="700" fill="${T.textMuted}" letter-spacing="1">LEGEND</text>`;

  const r1y = ly + 38;
  svg += `<line x1="${lx + 14}" y1="${r1y}" x2="${lx + 56}" y2="${r1y}" stroke="${T.dataArrow}" stroke-width="2.5" marker-end="url(#arrowBlue)"/>`;
  svg += `<text x="${lx + 64}" y="${r1y + 4}" font-family="${T.font}" font-size="12" fill="${T.textSecondary}">Data flow</text>`;

  svg += `<line x1="${lx + 164}" y1="${r1y}" x2="${lx + 206}" y2="${r1y}" stroke="${T.authArrow}" stroke-width="1.8" stroke-dasharray="8 4" marker-end="url(#arrowGray)"/>`;
  svg += `<text x="${lx + 214}" y="${r1y + 4}" font-family="${T.font}" font-size="12" fill="${T.textSecondary}">Auth / credential flow</text>`;

  svg += `<rect x="${lx + 380}" y="${r1y - 7}" width="40" height="14" rx="3" fill="none" stroke="${T.border}" stroke-width="1" stroke-dasharray="6 3"/>`;
  svg += `<text x="${lx + 428}" y="${r1y + 4}" font-family="${T.font}" font-size="12" fill="${T.textSecondary}">Logical boundary</text>`;

  const r2y = ly + 60;
  const tags = [
    { label: 'SERVICE', color: '#EF9A9A', bg: '#7F0000', desc: 'Managed service' },
    { label: 'LAYER',   color: '#BCAAA4', bg: '#3E2723', desc: 'Data layer' },
    { label: 'PROTOCOL', color: '#80DEEA', bg: '#004D40', desc: 'API / format' },
    { label: 'CLIENT',  color: '#CE93D8', bg: '#311B92', desc: 'Consumer app' },
  ];
  let tx = lx + 14;
  for (const t of tags) {
    const tw = t.label.length * 6.5 + 12;
    svg += `<rect x="${tx}" y="${r2y - 7}" width="${tw}" height="14" rx="3" fill="${t.bg}"/>`;
    svg += `<text x="${tx + tw / 2}" y="${r2y + 4}" text-anchor="middle" font-family="${T.font}" font-size="10" font-weight="600" fill="${t.color}" letter-spacing="0.5">${t.label}</text>`;
    svg += `<text x="${tx + tw + 6}" y="${r2y + 4}" font-family="${T.font}" font-size="12" fill="${T.textMuted}">${t.desc}</text>`;
    tx += tw + 106;
  }
  return svg;
}

function wrapSvg(w, h, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${body}\n</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGRAM 1 — Architecture Overview (4 swimlanes, 1600×1100)
// ═══════════════════════════════════════════════════════════════════════════
function buildArchitectureDiagram() {
  const W = 1740, H = 1100;
  const NODE_H = 100;
  const COMPACT_GAP = 32;            // for lane 2 (tightly packed pipeline)
  const PAD = 20;                    // swimlane internal padding

  // Vertical zones
  const LANE_TOP = 64;
  const HEADER_H = 34;
  const CONTENT_TOP = LANE_TOP + HEADER_H + PAD; // 118
  const LEGEND_TOP = H - 106;
  const LANE_BOT = LEGEND_TOP - 10;
  const AVAIL = LANE_BOT - CONTENT_TOP;

  // ── SWIMLANE X-POSITIONS (content-aware proportional sizing) ──
  const L1 = { x: 20, w: 290 };
  const L2 = { x: 330, w: 672 };   // +112px from L4 — room for 2 wider sub-columns
  const L3 = { x: 1022, w: 340 };
  const L4 = { x: 1382, w: 338 };  // −25% — consumer subtitles are short

  // ── PRE-COMPUTE ALL NODE POSITIONS ──

  // Lane 1: 4 source nodes, space-evenly
  const srcX = L1.x + PAD, srcW = L1.w - PAD * 2;                      // x=40, w=240
  const srcYs = distributeEvenly(CONTENT_TOP, AVAIL, 4, NODE_H);

  // Lane 2: two sub-columns, compact gaps
  // Left: ADF + Medallion (4 nodes). Right: UC (3 nodes, starting at Gold's Y)
  const l2LX = L2.x + PAD, l2LW = 290;                                 // wider Medallion cards
  const l2RX = L2.x + PAD + l2LW + 50, l2RW = 290;                     // wider Unity Catalog cards
  const adfY = srcYs[0]; // ADF aligned with first source → horizontal arrows
  const l2LeftYs = Array.from({ length: 4 }, (_, i) => adfY + i * (NODE_H + COMPACT_GAP));
  const goldY = l2LeftYs[3];
  const l2RightYs = Array.from({ length: 3 }, (_, i) => goldY + i * (NODE_H + COMPACT_GAP));

  // Lane 3: 4 auth nodes, packed at TOP (compact gaps) — so blue arrows pass below
  const authX = L3.x + PAD, authW = L3.w - PAD * 2;                    // x=880, w=280
  const authYs = Array.from({ length: 4 }, (_, i) => CONTENT_TOP + i * (NODE_H + COMPACT_GAP));

  // Lane 4: 5 consumer nodes, packed at BOTTOM — so blue arrows pass above
  const conX = L4.x + PAD, conW = L4.w - PAD * 2;                      // x=1220, w=340
  const conTotalH = 5 * NODE_H + 4 * COMPACT_GAP;                      // 628
  const conStartY = LANE_BOT - conTotalH;                              // bottom-aligned
  const conYs = Array.from({ length: 5 }, (_, i) => conStartY + i * (NODE_H + COMPACT_GAP));

  // ── OVERLAP CHECK ──
  const allRects = [
    ...srcYs.map((y, i) => ({ id: `src-${i}`, x: srcX, y, w: srcW, h: NODE_H })),
    ...l2LeftYs.map((y, i) => ({ id: `l2L-${i}`, x: l2LX, y, w: l2LW, h: NODE_H })),
    ...l2RightYs.map((y, i) => ({ id: `l2R-${i}`, x: l2RX, y, w: l2RW, h: NODE_H })),
    ...authYs.map((y, i) => ({ id: `auth-${i}`, x: authX, y, w: authW, h: NODE_H })),
    ...conYs.map((y, i) => ({ id: `con-${i}`, x: conX, y, w: conW, h: NODE_H })),
  ];
  const overlaps = checkOverlap(allRects);
  if (overlaps.length) {
    console.error('  ❌ OVERLAP in architecture layout:');
    overlaps.forEach(e => console.error(`     ${e}`));
    process.exit(1);
  }
  console.log(`  ✅ Architecture layout: ${allRects.length} nodes, 0 overlaps`);

  // ── LOGO CHECK ──
  const logoKeys = ['mssql', 'azure', 'databricks', 'delta', 'iceberg', 'spark', 'python', 'snowflake', 'trino', 'duckdb'];
  const missingLogos = logoKeys.filter(k => !EMBEDDED[k]);
  if (missingLogos.length) console.warn(`  ⚠️  Missing logos: ${missingLogos.join(', ')}`);

  // ═══════════ BUILD SVG ═══════════
  let svg = '';
  svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
  svg += `<rect width="${W}" height="${H}" fill="url(#dotGrid)"/>`;
  svg += svgDefs();

  // Title
  svg += `<text x="${W / 2}" y="30" text-anchor="middle" font-family="${T.font}" font-size="24" font-weight="700" fill="${T.textPrimary}">newUM Data Architecture — Iceberg REST Catalog Integration</text>`;
  svg += `<text x="${W / 2}" y="52" text-anchor="middle" font-family="${T.font}" font-size="15" fill="${T.textMuted}">ADO #186438  ·  Data Team  ·  2026-03-25  ·  Architecture Overview + Auth Flow</text>`;

  // Swimlane backgrounds + headers
  const laneConfigs = [
    { ...L1, bg: T.swimlaneBg[0], hd: T.swimlaneHd[0], label: 'DATA SOURCES', num: '①' },
    { ...L2, bg: T.swimlaneBg[1], hd: T.swimlaneHd[1], label: 'AZURE DATABRICKS · UNITY CATALOG', num: '②' },
    { ...L3, bg: T.swimlaneBg[2], hd: T.swimlaneHd[2], label: 'AUTH LAYER', num: '③' },
    { ...L4, bg: T.swimlaneBg[3], hd: T.swimlaneHd[3], label: 'EXTERNAL CONSUMERS', num: '④' },
  ];
  for (const l of laneConfigs) {
    svg += `<rect x="${l.x}" y="${LANE_TOP}" width="${l.w}" height="${LANE_BOT - LANE_TOP}" rx="8" fill="${l.bg}" stroke="${T.border}" stroke-width="1"/>`;
    svg += swimlaneHeader(l.x, LANE_TOP, l.w, l.hd, l.label, l.num);
  }

  // ── LANE 1: Data Sources (4 MS-SQL databases) ──
  const srcData = [
    { logo: 'mssql', name: 'oadb', sub: 'MATIS core operational database', tag: 'SERVICE' },
    { logo: 'mssql', name: 'DrugsMS', sub: 'Master / Payer drug library', tag: 'SERVICE' },
    { logo: 'mssql', name: 'EligibilityMS', sub: 'Member eligibility data', tag: 'SERVICE' },
    { logo: 'mssql', name: 'ProviderMS', sub: 'Provider network directory', tag: 'SERVICE' },
  ];
  for (let i = 0; i < srcData.length; i++) {
    const n = srcData[i];
    svg += nodeBox(srcX, srcYs[i], srcW, NODE_H, C.mssql, n.logo, n.name, n.sub, n.tag);
  }
  svg += sectionFrame(srcX - 6, srcYs[0] - 10, srcW + 12, srcYs[3] + NODE_H - srcYs[0] + 24, 'MS-SQL Server', '#CC2927');

  // ── LANE 2 LEFT: ADF + Medallion ──
  const l2LeftData = [
    { logo: 'azure', name: 'ADF / Lakeflow Connect', sub: 'Azure Data Factory — batch ingestion', tag: 'SERVICE', colors: C.ingestion },
    { logo: 'databricks', name: 'Bronze Layer', sub: 'Raw ingestion — source-zone aligned', tag: 'LAYER', colors: C.bronze },
    { logo: 'databricks', name: 'Silver Layer', sub: 'Cleaned, conformed, deduplicated', tag: 'LAYER', colors: C.silver },
    { logo: 'databricks', name: 'Gold Layer', sub: 'Curated aggregates, business-ready', tag: 'LAYER', colors: C.gold },
  ];
  for (let i = 0; i < l2LeftData.length; i++) {
    svg += nodeBox(l2LX, l2LeftYs[i], l2LW, NODE_H, l2LeftData[i].colors, l2LeftData[i].logo, l2LeftData[i].name, l2LeftData[i].sub, l2LeftData[i].tag);
  }
  svg += sectionFrame(l2LX - 6, l2LeftYs[1] - 10, l2LW + 12, l2LeftYs[3] + NODE_H - l2LeftYs[1] + 24, 'Medallion Architecture');

  // ── LANE 2 RIGHT: Unity Catalog ──
  const l2RightData = [
    { logo: 'delta', name: 'Delta Table', sub: 'Source of truth — ACID transactions', tag: 'LAYER', colors: C.delta },
    { logo: 'iceberg', name: 'UniForm', sub: 'IcebergCompatV2 metadata bridge', tag: 'PROTOCOL', colors: C.uniform },
    { logo: 'iceberg', name: 'Iceberg REST Catalog', sub: '/api/2.1/unity-catalog/iceberg-rest', tag: 'PROTOCOL', colors: C.api },
  ];
  for (let i = 0; i < l2RightData.length; i++) {
    svg += nodeBox(l2RX, l2RightYs[i], l2RW, NODE_H, l2RightData[i].colors, l2RightData[i].logo, l2RightData[i].name, l2RightData[i].sub, l2RightData[i].tag);
  }
  svg += sectionFrame(l2RX - 6, l2RightYs[0] - 10, l2RW + 12, l2RightYs[2] + NODE_H - l2RightYs[0] + 24, 'Unity Catalog');

  // ── LANE 3: Auth Layer ──
  const authData = [
    { logo: 'entra', name: 'OAuth M2M', sub: 'Service principal + client secret', tag: 'PROTOCOL', badge: { label: 'PROD', bg: '#2E7D32', color: '#A5D6A7' } },
    { logo: 'pat', name: 'Personal Access Token', sub: 'Configurable expiry — dev and CI', tag: 'PROTOCOL', badge: { label: 'DEV/PROD', bg: '#E65100', color: '#FFE0B2' } },
    { logo: 'sas', name: 'SAS Credential Vending', sub: 'Temporary ADLS Gen2 tokens (1h)', tag: 'PROTOCOL', badge: null },
    { logo: 'entra', name: 'Entra ID (Azure AD)', sub: 'Snowflake SP OAuth — public network', tag: 'SERVICE', badge: null },
  ];
  for (let i = 0; i < authData.length; i++) {
    const n = authData[i];
    svg += nodeBox(authX, authYs[i], authW, NODE_H, C.auth, n.logo, n.name, n.sub, n.tag, n.badge);
  }
  svg += sectionFrame(authX - 6, authYs[0] - 10, authW + 12, authYs[3] + NODE_H - authYs[0] + 24, 'Authentication Flow', '#5C6BC0');

  // Auth vertical arrows (OAuth → PAT → SAS)
  for (let i = 0; i < 2; i++) {
    const y1 = authYs[i] + NODE_H;
    const y2 = authYs[i + 1];
    svg += authArrow(authX + authW / 2, y1, authX + authW / 2, y2, i === 0 ? 'grants' : 'issues');
  }

  // ── LANE 4: External Consumers ──
  const conData = [
    { logo: 'spark', name: 'Apache Spark', sub: 'iceberg-azure-bundle (ADLS Gen2)', tag: 'CLIENT', colors: C.spark },
    { logo: 'python', name: 'PyIceberg', sub: 'pip install pyiceberg[pyarrow]', tag: 'CLIENT', colors: C.pyiceberg },
    { logo: 'snowflake', name: 'Snowflake', sub: 'Catalog-linked DB, auto-sync', tag: 'CLIENT', colors: C.snowflake },
    { logo: 'trino', name: 'Trino / Flink', sub: 'Iceberg REST catalog connector', tag: 'CLIENT', colors: C.trino },
    { logo: 'duckdb', name: 'DuckDB', sub: 'Community Iceberg extension', tag: 'CLIENT', colors: C.duckdb },
  ];
  for (let i = 0; i < conData.length; i++) {
    svg += nodeBox(conX, conYs[i], conW, NODE_H, conData[i].colors, conData[i].logo, conData[i].name, conData[i].sub, conData[i].tag);
  }
  svg += sectionFrame(conX - 6, conYs[0] - 10, conW + 12, conYs[4] + NODE_H - conYs[0] + 24, 'HTTPS \u00b7 read-only', '#2E7D32');

  // ═══════════ DATA FLOW ARROWS ═══════════

  // Sources → ADF (fan-in)
  const adfCY = adfY + NODE_H / 2;
  for (let i = 0; i < srcData.length; i++) {
    const sy = srcYs[i] + NODE_H / 2;
    svg += `<path d="M${srcX + srcW},${sy} L${l2LX},${adfCY}" fill="none" stroke="${T.dataArrow}" stroke-width="2" opacity="${i === 0 ? 1 : 0.4}" marker-end="url(#arrowBlue)"/>`;
  }
  svg += arrowLabel((srcX + srcW + l2LX) / 2, adfCY - 14, 'batch / CDC', T.dataArrow);

  // ADF → Bronze
  svg += dataArrow(l2LX + l2LW / 2, l2LeftYs[0] + NODE_H, l2LX + l2LW / 2, l2LeftYs[1], 'ingest');

  // Bronze → Silver → Gold
  svg += dataArrow(l2LX + l2LW / 2, l2LeftYs[1] + NODE_H, l2LX + l2LW / 2, l2LeftYs[2], 'clean');
  svg += dataArrow(l2LX + l2LW / 2, l2LeftYs[2] + NODE_H, l2LX + l2LW / 2, l2LeftYs[3], 'curate');

  // Gold → Delta (horizontal — same Y level)
  svg += dataArrow(l2LX + l2LW, goldY + NODE_H / 2, l2RX, goldY + NODE_H / 2, 'write');

  // Delta → UniForm → Iceberg REST
  svg += dataArrow(l2RX + l2RW / 2, l2RightYs[0] + NODE_H, l2RX + l2RW / 2, l2RightYs[1], 'triggers');
  svg += dataArrow(l2RX + l2RW / 2, l2RightYs[1] + NODE_H, l2RX + l2RW / 2, l2RightYs[2], 'metadata');

  // Iceberg REST → Consumers (fan-out)
  const apiCY = l2RightYs[2] + NODE_H / 2;
  for (let i = 0; i < conData.length; i++) {
    const cy = conYs[i] + NODE_H / 2;
    svg += `<path d="M${l2RX + l2RW},${apiCY} Q${(l2RX + l2RW + conX) / 2},${(apiCY + cy) / 2} ${conX},${cy}" fill="none" stroke="${T.dataArrow}" stroke-width="1.8" opacity="${i === 0 ? 0.8 : 0.45}" marker-end="url(#arrowBlue)"/>`;
  }
  svg += arrowLabel((l2RX + l2RW + conX) / 2, apiCY - 20, 'HTTPS + SAS tokens', T.dataArrow);

  // ═══════════ AUTH ARROWS ═══════════
  // SAS → Iceberg API
  const sasCY = authYs[2] + NODE_H / 2;
  svg += authArrow(authX, sasCY, l2RX + l2RW, apiCY, 'vends to API');

  // Entra → Snowflake
  const entraCY = authYs[3] + NODE_H / 2;
  const snowCY = conYs[2] + NODE_H / 2;
  svg += authArrow(authX + authW, entraCY, conX, snowCY, 'Entra SP OAuth');

  // ═══════════ LEGEND ═══════════
  svg += legendBlock(20, LEGEND_TOP, W - 40);
  svg += `<text x="${W - 12}" y="${H - 6}" text-anchor="end" font-family="${T.font}" font-size="10" fill="#263238">Generated by NFG · ${new Date().toISOString().split('T')[0]}</text>`;

  return wrapSvg(W, H, svg);
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGRAM 2 — newUM Data Flow (vertical pipeline, 1200×1300)
// ═══════════════════════════════════════════════════════════════════════════
function buildNewumFlowDiagram() {
  const W = 1360, H = 1300;
  const NODE_H = 100;
  const COMPACT_GAP = 32;
  const PAD = 20;

  const CONTENT_TOP = 70;
  const LEGEND_TOP = H - 106;

  // ── Column positions (content-aware proportional sizing) ──
  // Pipeline widest (45-char subs), auth medium (38-char), consumers narrowest (32-char)
  const pipeX = 30, pipeW = 460;
  const authX = 530, authW = 400;
  const conX = 970, conW = 360;

  // ── Pipeline: 8 nodes, compact gaps ──
  const pipeYs = Array.from({ length: 8 }, (_, i) => CONTENT_TOP + i * (NODE_H + COMPACT_GAP));
  // Last bottom: 70 + 7*132 + 100 = 70 + 924 + 100 = 1094

  // ── Auth: 2 nodes, packed at TOP (aligned with ADF level) — clears blue arrows below
  const authStartY = pipeYs[1]; // ADF level — keeps auth high
  const authYs = [authStartY, authStartY + NODE_H + COMPACT_GAP];

  // Auth frame bounds
  const authFrameX = authX - 10, authFrameY = authStartY - 10;
  const authFrameW = authW + 20, authFrameH = (authYs[1] + NODE_H) - authStartY + 24; // 832-598+36 = 270

  // ── Consumers: 5 nodes, packed at BOTTOM — clears blue arrows from auth zone
  const conTotalH = 5 * NODE_H + 4 * COMPACT_GAP;                      // 628
  const conStartY = LEGEND_TOP - 10 - conTotalH;                       // bottom-aligned
  const conYs = Array.from({ length: 5 }, (_, i) => conStartY + i * (NODE_H + COMPACT_GAP));

  // ── OVERLAP CHECK ──
  const allRects = [
    ...pipeYs.map((y, i) => ({ id: `pipe-${i}`, x: pipeX, y, w: pipeW, h: NODE_H })),
    ...authYs.map((y, i) => ({ id: `auth-${i}`, x: authX, y, w: authW, h: NODE_H })),
    ...conYs.map((y, i) => ({ id: `con-${i}`, x: conX, y, w: conW, h: NODE_H })),
  ];
  // Note: auth frame is a visual container — NOT included in overlap check
  // (it intentionally surrounds auth nodes)

  const overlaps = checkOverlap(allRects);
  if (overlaps.length) {
    console.error('  ❌ OVERLAP in flow layout:');
    overlaps.forEach(e => console.error(`     ${e}`));
    process.exit(1);
  }
  console.log(`  ✅ Flow layout: ${allRects.length} nodes/frames, 0 overlaps`);

  // ═══════════ BUILD SVG ═══════════
  let svg = '';
  svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
  svg += `<rect width="${W}" height="${H}" fill="url(#dotGrid)"/>`;
  svg += svgDefs();

  // Title
  svg += `<text x="${W / 2}" y="30" text-anchor="middle" font-family="${T.font}" font-size="24" font-weight="700" fill="${T.textPrimary}">newUM Data Pipeline — End-to-End Flow</text>`;
  svg += `<text x="${W / 2}" y="52" text-anchor="middle" font-family="${T.font}" font-size="15" fill="${T.textMuted}">ADO #186438  ·  Sources → Medallion → UniForm → Iceberg REST → Consumers</text>`;

  // ── Pipeline nodes ──
  const pipeData = [
    { logo: 'mssql', name: 'MS-SQL Sources', sub: 'oadb · DrugsMS · EligibilityMS · ProviderMS', tag: 'SERVICE', colors: C.mssql },
    { logo: 'azure', name: 'ADF / Lakeflow Connect', sub: 'Azure Data Factory — daily batch ingestion', tag: 'SERVICE', colors: C.ingestion },
    { logo: 'databricks', name: 'Bronze Layer', sub: 'Raw ingestion — source-zone aligned tables', tag: 'LAYER', colors: C.bronze },
    { logo: 'databricks', name: 'Silver Layer', sub: 'Cleaned, conformed, deduplicated', tag: 'LAYER', colors: C.silver },
    { logo: 'databricks', name: 'Gold Layer', sub: 'Curated aggregates, business-ready views', tag: 'LAYER', colors: C.gold },
    { logo: 'delta', name: 'Delta Tables (Unity Catalog)', sub: '127 Delta tables · 8 catalogs · ACID transactions', tag: 'LAYER', colors: C.delta },
    { logo: 'iceberg', name: 'UniForm (IcebergCompatV2)', sub: 'Automatic Iceberg metadata bridge', tag: 'PROTOCOL', colors: C.uniform },
    { logo: 'iceberg', name: 'Iceberg REST Catalog API', sub: '/api/2.1/unity-catalog/iceberg-rest', tag: 'PROTOCOL', colors: C.api },
  ];
  svg += sectionFrame(pipeX - 10, CONTENT_TOP - 10, pipeW + 20, pipeYs[7] + NODE_H - CONTENT_TOP + 24, 'Azure Databricks Pipeline', '#FF3621');
  for (let i = 0; i < pipeData.length; i++) {
    svg += nodeBox(pipeX, pipeYs[i], pipeW, NODE_H, pipeData[i].colors, pipeData[i].logo, pipeData[i].name, pipeData[i].sub, pipeData[i].tag);
  }

  // Pipeline vertical arrows
  const pipeLabels = ['ingest', 'land', 'clean', 'curate', 'write', 'enable', 'expose'];
  for (let i = 0; i < pipeData.length - 1; i++) {
    svg += dataArrow(pipeX + pipeW / 2, pipeYs[i] + NODE_H, pipeX + pipeW / 2, pipeYs[i + 1], pipeLabels[i]);
  }

  // ── Auth flow nodes ──
  svg += sectionFrame(authFrameX, authFrameY, authFrameW, authFrameH, 'Auth Flow', '#5C6BC0');
  const authData = [
    { logo: 'entra', name: 'OAuth M2M / PAT', sub: 'Authentication to workspace', tag: 'PROTOCOL' },
    { logo: 'sas', name: 'SAS Credential Vending', sub: 'Temporary ADLS Gen2 tokens (1h expiry)', tag: 'PROTOCOL' },
  ];
  for (let i = 0; i < authData.length; i++) {
    svg += nodeBox(authX, authYs[i], authW, NODE_H, C.auth, authData[i].logo, authData[i].name, authData[i].sub, authData[i].tag);
  }
  svg += authArrow(authX + authW / 2, authYs[0] + NODE_H, authX + authW / 2, authYs[1], 'issues');

  // Auth → API arrow (SAS vends tokens to Iceberg REST)
  const sasBottomCY = authYs[1] + NODE_H / 2;
  const apiCY = pipeYs[7] + NODE_H / 2;
  svg += `<path d="M${authX},${sasBottomCY} L${authX - 14},${sasBottomCY} L${pipeX + pipeW + 6},${apiCY}" fill="none" stroke="${T.authArrow}" stroke-width="1.5" stroke-dasharray="6 3" marker-end="url(#arrowGray)"/>`;
  svg += arrowLabel(authX - 50, (sasBottomCY + apiCY) / 2, 'vends tokens', T.authArrow);

  // ── Consumer nodes ──
  const conData = [
    { logo: 'spark', name: 'Apache Spark', sub: 'iceberg-azure-bundle (ADLS Gen2)', tag: 'CLIENT', colors: C.spark },
    { logo: 'python', name: 'PyIceberg', sub: 'pip install pyiceberg[pyarrow]', tag: 'CLIENT', colors: C.pyiceberg },
    { logo: 'snowflake', name: 'Snowflake', sub: 'Catalog-linked DB, auto-sync', tag: 'CLIENT', colors: C.snowflake },
    { logo: 'trino', name: 'Trino / Flink', sub: 'Iceberg REST catalog connector', tag: 'CLIENT', colors: C.trino },
    { logo: 'duckdb', name: 'DuckDB', sub: 'Community Iceberg extension', tag: 'CLIENT', colors: C.duckdb },
  ];
  svg += sectionFrame(conX - 8, conYs[0] - 10, conW + 16, conYs[4] + NODE_H - conYs[0] + 24, 'HTTPS \u00b7 read-only', '#2E7D32');
  for (let i = 0; i < conData.length; i++) {
    svg += nodeBox(conX, conYs[i], conW, NODE_H, conData[i].colors, conData[i].logo, conData[i].name, conData[i].sub, conData[i].tag);
  }

  // API → Consumers fan-out
  const icebergOutY = pipeYs[7] + NODE_H / 2;
  for (let i = 0; i < conData.length; i++) {
    const cy = conYs[i] + NODE_H / 2;
    svg += `<path d="M${pipeX + pipeW},${icebergOutY} Q${(pipeX + pipeW + conX) / 2},${(icebergOutY + cy) / 2} ${conX},${cy}" fill="none" stroke="${T.dataArrow}" stroke-width="1.8" opacity="${i === 0 ? 0.8 : 0.45}" marker-end="url(#arrowBlue)"/>`;
  }
  svg += arrowLabel((pipeX + pipeW + conX) / 2, icebergOutY - 16, 'HTTPS + SAS', T.dataArrow);

  // ═══════════ LEGEND ═══════════
  svg += legendBlock(PAD, LEGEND_TOP, W - PAD * 2);
  svg += `<text x="${W - 12}" y="${H - 6}" text-anchor="end" font-family="${T.font}" font-size="10" fill="#263238">Generated by NFG · ${new Date().toISOString().split('T')[0]}</text>`;

  return wrapSvg(W, H, svg);
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER TO PNG (Playwright)
// ═══════════════════════════════════════════════════════════════════════════
async function renderPNG(svgPath, pngPath, width, height) {
  const { chromium } = require('playwright');
  const svgContent = fs.readFileSync(svgPath, 'utf-8');
  const html = `<!DOCTYPE html><html><head><style>body{margin:0;background:${T.bg};display:inline-block;}</style></head><body>${svgContent}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: width + 40, height: height + 40 },
    deviceScaleFactor: 2,
  });
  await page.setContent(html, { waitUntil: 'networkidle' });
  // No external image loading needed — all logos are embedded as data URIs
  const svgEl = await page.$('svg');
  await svgEl.screenshot({ path: pngPath, type: 'png' });
  await browser.close();
  const kb = (fs.statSync(pngPath).size / 1024).toFixed(1);
  console.log(`  📸 PNG: ${path.basename(pngPath)} (${kb} KB)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('🔷 Rendering v5 diagrams — embedded logos, pre-validated layout, 100px cards\n');

  // Step 1: Load inline SVG logos (synchronous — no network)
  loadAllLogos();

  const diagrams = [
    { name: 'diagram-architecture', build: buildArchitectureDiagram, w: 1740, h: 1100 },
    { name: 'diagram-newum-flow',   build: buildNewumFlowDiagram,    w: 1360, h: 1300 },
  ];

  for (const d of diagrams) {
    console.log(`  🔷 ${d.name}:`);
    const svgStr = d.build();
    const svgPath = path.join(OUT_DIR, `${d.name}.svg`);
    fs.writeFileSync(svgPath, svgStr);
    const svgKB = (Buffer.byteLength(svgStr) / 1024).toFixed(1);
    console.log(`  ✅ SVG: ${d.name}.svg (${svgKB} KB)`);

    if (RENDER_PNG) {
      try {
        await renderPNG(svgPath, path.join(OUT_DIR, `${d.name}.png`), d.w, d.h);
      } catch (err) {
        console.error(`  ⚠️ PNG failed: ${err.message}`);
      }
    }
  }

  console.log('\n✨ Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
