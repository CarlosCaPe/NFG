#!/usr/bin/env node
/**
 * render-diagram.js — Config-driven architecture diagram renderer
 *
 * Renders dark-themed SVG architecture diagrams with embedded logos, swimlanes,
 * auto-layout, overlap validation, and optional PNG export via Playwright.
 *
 * Usage:
 *   node shared/render-diagram.js --config <diagram.json> [--png] [--out <dir>]
 *
 * Config JSON schema: see shared/diagram-schema.md or examples in clients/
 *
 * Reusable across all NFG clients. Logo library in shared/logos/.
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}
const configPath = getArg('config');
const RENDER_PNG = args.includes('--png');
const OUT_DIR = getArg('out') || '.';

if (!configPath) {
  console.error('Usage: node shared/render-diagram.js --config <diagram.json> [--png] [--out <dir>]');
  console.error('\nExample: node shared/render-diagram.js --config clients/oncohealth/tickets/186438-iceberg-rest-catalog/diagrams.json --png');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS (dark theme)
// ═══════════════════════════════════════════════════════════════════════════
const T = {
  bg:            '#0F1318',
  swimlaneBg:    ['#1A1520', '#1A1D24', '#1A2024', '#1A2418', '#1A1828', '#1E1A20'],
  swimlaneHd:    ['#C62828', '#E65100', '#1565C0', '#2E7D32', '#6A1B9A', '#F57F17'],
  border:        '#2A3040',
  textPrimary:   '#ECEFF1',
  textSecondary: '#90A4AE',
  textMuted:     '#546E7A',
  dataArrow:     '#42A5F5',
  authArrow:     '#78909C',
  font:          "'Segoe UI','Inter','Helvetica Neue',system-ui,sans-serif",
};

// Card color palettes — extensible via config
const PALETTES = {
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
  dotnet:    { fill: '#1A0E2E', stroke: '#512BD4', text: '#D1C4E9', tag: '#B39DDB', accent: '#512BD4' },
  react:     { fill: '#0A1E2C', stroke: '#61DAFB', text: '#B3E5FC', tag: '#81D4FA', accent: '#61DAFB' },
  kubernetes:{ fill: '#0A1233', stroke: '#326CE5', text: '#BBDEFB', tag: '#90CAF9', accent: '#326CE5' },
  terraform: { fill: '#0A1A2E', stroke: '#7B42BC', text: '#D1C4E9', tag: '#B39DDB', accent: '#7B42BC' },
  kafka:     { fill: '#1E1E1E', stroke: '#231F20', text: '#E0E0E0', tag: '#BDBDBD', accent: '#231F20' },
  redis:     { fill: '#1E0A0A', stroke: '#DC382D', text: '#FFCDD2', tag: '#EF9A9A', accent: '#DC382D' },
  postgres:  { fill: '#0A1A2E', stroke: '#336791', text: '#BBDEFB', tag: '#90CAF9', accent: '#336791' },
  generic:   { fill: '#1A1E24', stroke: '#546E7A', text: '#CFD8DC', tag: '#90A4AE', accent: '#546E7A' },
};

// ═══════════════════════════════════════════════════════════════════════════
// LOGO LOADING
// ═══════════════════════════════════════════════════════════════════════════
const LOGOS_DIR = path.join(__dirname, 'logos');

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
  duckdb:     { file: 'duckdb.svg',       bg: '#FFF000', fill: '#000', type: 'simple' },
  entra:      { file: 'person.svg',       bg: '#0078D4', fill: '#fff', type: 'fluent' },
  pat:        { file: 'key.svg',          bg: '#1a3a6e', fill: '#fff', type: 'fluent' },
  sas:        { file: 'shield.svg',       bg: '#0050a0', fill: '#fff', type: 'fluent' },
  apacheflink:{ file: 'apacheflink.svg',  bg: '#E6526F', fill: '#fff', type: 'simple' },
};

let EMBEDDED = {};

function wrapInBadge(innerSvg, bg, iconFill, size) {
  const pad = Math.round(size * 0.15);
  const iconSize = size - pad * 2;
  const scale = iconSize / 24;
  let processedInner = innerSvg
    .replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '').replace(/<title>[^<]*<\/title>/, '');
  if (iconFill) {
    processedInner = processedInner.replace(/fill="none"/g, `fill="${iconFill}"`);
    processedInner = processedInner.replace(/<path(?![^>]*fill=)/g, `<path fill="${iconFill}"`);
  }
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="${bg}"/>`
    + `<g transform="translate(${pad},${pad}) scale(${scale.toFixed(4)})">${processedInner}</g>`
    + `</svg>`;
}

function loadAllLogos() {
  let ok = 0;
  for (const [key, cfg] of Object.entries(LOGO_MAP)) {
    const filePath = path.join(LOGOS_DIR, cfg.file);
    if (!fs.existsSync(filePath)) continue;
    if (cfg.type === 'png') {
      EMBEDDED[key] = `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
    } else {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const wrapped = wrapInBadge(raw, cfg.bg, cfg.fill, 36);
      EMBEDDED[key] = `data:image/svg+xml;base64,${Buffer.from(wrapped).toString('base64')}`;
    }
    ok++;
  }
  console.log(`  Loaded ${ok} logos from shared/logos/`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYOUT ENGINE
// ═══════════════════════════════════════════════════════════════════════════
function checkOverlap(rects) {
  const errs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        errs.push(`"${a.id}" overlaps "${b.id}"`);
    }
  }
  return errs;
}

function distributeEvenly(startY, availH, count, nodeH) {
  const gap = (availH - count * nodeH) / (count + 1);
  return Array.from({ length: count }, (_, i) => Math.round(startY + gap * (i + 1) + nodeH * i));
}

function distributeCompact(startY, count, nodeH, gap) {
  return Array.from({ length: count }, (_, i) => startY + i * (nodeH + gap));
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function wrapText(text, maxPx, charWidth) {
  charWidth = charWidth || 7.5;
  const maxChars = Math.floor(maxPx / charWidth);
  if (text.length <= maxChars) return [text];
  const rawWords = text.split(/\s+/);
  const words = [];
  for (const w of rawWords) {
    if (w.length <= maxChars) { words.push(w); continue; }
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
    if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
    else { cur = test; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function nodeBox(x, y, w, h, colors, logoKey, name, subtitle, tag, badge) {
  const rx = 8;
  let svg = '';
  svg += `<rect x="${x + 2}" y="${y + 3}" width="${w}" height="${h}" rx="${rx}" fill="#000" opacity="0.2"/>`;
  svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.8"/>`;
  svg += `<rect x="${x}" y="${y + 4}" width="4" height="${h - 8}" rx="2" fill="${colors.accent || colors.stroke}" opacity="0.9"/>`;

  const logoSize = 40;
  const logoX = x + 12;
  const logoY = y + (h - logoSize) / 2;
  const dataUri = logoKey ? EMBEDDED[logoKey] : null;
  let hasLogo = false;

  if (dataUri) {
    svg += `<image href="${dataUri}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}"/>`;
    hasLogo = true;
  } else if (logoKey) {
    svg += `<rect x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" rx="6" fill="${colors.accent}" opacity="0.7"/>`;
    svg += `<text x="${logoX + logoSize / 2}" y="${logoY + logoSize / 2 + 5}" text-anchor="middle" font-family="${T.font}" font-size="13" font-weight="700" fill="#fff">${esc(logoKey.slice(0, 3).toUpperCase())}</text>`;
    hasLogo = true;
  }

  const textX = hasLogo ? logoX + logoSize + 10 : x + 14;
  const availTextW = w - (textX - x) - 8;
  const subLines = subtitle ? wrapText(subtitle, availTextW, 7.5) : [];
  const lineH = 15;
  const textBlockH = 16 + (subLines.length ? 4 + subLines.length * lineH : 0);
  const nameY = y + Math.max(20, Math.round((h - textBlockH) / 2) + 14);

  svg += `<text x="${textX}" y="${nameY}" font-family="${T.font}" font-size="16" font-weight="600" fill="${colors.text}">${esc(name)}</text>`;
  for (let li = 0; li < subLines.length; li++) {
    svg += `<text x="${textX}" y="${nameY + 18 + li * lineH}" font-family="${T.font}" font-size="13" fill="${T.textSecondary}">${esc(subLines[li])}</text>`;
  }

  if (tag) {
    const tagW = tag.length * 6.5 + 12;
    svg += `<rect x="${x + w - tagW - 8}" y="${y + h - 26}" width="${tagW}" height="16" rx="4" fill="${colors.stroke}" opacity="0.6"/>`;
    svg += `<text x="${x + w - tagW / 2 - 8}" y="${y + h - 15}" text-anchor="middle" font-family="${T.font}" font-size="10" font-weight="700" fill="${colors.tag}" letter-spacing="0.5">${esc(tag)}</text>`;
  }

  if (badge) {
    const bW = badge.label.length * 6 + 14;
    svg += `<rect x="${x + w - bW - 8}" y="${y + 6}" width="${bW}" height="16" rx="3" fill="${badge.bg}"/>`;
    svg += `<text x="${x + w - bW / 2 - 8}" y="${y + 17}" text-anchor="middle" font-family="${T.font}" font-size="9" font-weight="700" fill="${badge.color}" letter-spacing="0.5">${esc(badge.label)}</text>`;
  }

  return svg;
}

function dataArrow(x1, y1, x2, y2, label) {
  let svg = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${T.dataArrow}" stroke-width="2.5" marker-end="url(#arrowBlue)"/>`;
  if (label) svg += arrowLabel((x1 + x2) / 2, (y1 + y2) / 2 - 8, label, T.dataArrow);
  return svg;
}

function authArrow(x1, y1, x2, y2, label) {
  let svg = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${T.authArrow}" stroke-width="1.8" stroke-dasharray="8 4" marker-end="url(#arrowGray)"/>`;
  if (label) svg += arrowLabel((x1 + x2) / 2, (y1 + y2) / 2 - 8, label, T.authArrow);
  return svg;
}

function curvedArrow(x1, y1, x2, y2, color, opacity) {
  return `<path d="M${x1},${y1} Q${(x1 + x2) / 2},${(y1 + y2) / 2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="1.8" opacity="${opacity || 0.6}" marker-end="url(#arrowBlue)"/>`;
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
    { label: 'SERVICE', color: '#EF9A9A', bg: '#7F0000' },
    { label: 'LAYER',   color: '#BCAAA4', bg: '#3E2723' },
    { label: 'PROTOCOL', color: '#80DEEA', bg: '#004D40' },
    { label: 'CLIENT',  color: '#CE93D8', bg: '#311B92' },
  ];
  let tx = lx + 14;
  for (const t of tags) {
    const tw = t.label.length * 6.5 + 12;
    svg += `<rect x="${tx}" y="${r2y - 7}" width="${tw}" height="14" rx="3" fill="${t.bg}"/>`;
    svg += `<text x="${tx + tw / 2}" y="${r2y + 4}" text-anchor="middle" font-family="${T.font}" font-size="10" font-weight="600" fill="${t.color}" letter-spacing="0.5">${t.label}</text>`;
    tx += tw + 50;
  }
  return svg;
}

function wrapSvg(w, h, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${body}\n</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG-DRIVEN DIAGRAM BUILDER
// ═══════════════════════════════════════════════════════════════════════════
function buildFromConfig(diagram) {
  const W = diagram.width || 1600;
  const H = diagram.height || 1100;
  const NODE_H = diagram.nodeHeight || 100;
  const GAP = diagram.gap || 32;
  const PAD = diagram.padding || 20;

  const LANE_TOP = 64;
  const HEADER_H = 34;
  const CONTENT_TOP = LANE_TOP + HEADER_H + PAD;
  const LEGEND_TOP = H - 106;
  const LANE_BOT = LEGEND_TOP - 10;
  const AVAIL = LANE_BOT - CONTENT_TOP;

  let svg = '';
  svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
  svg += `<rect width="${W}" height="${H}" fill="url(#dotGrid)"/>`;
  svg += svgDefs();

  // Title
  svg += `<text x="${W / 2}" y="30" text-anchor="middle" font-family="${T.font}" font-size="24" font-weight="700" fill="${T.textPrimary}">${esc(diagram.title)}</text>`;
  if (diagram.subtitle) {
    svg += `<text x="${W / 2}" y="52" text-anchor="middle" font-family="${T.font}" font-size="15" fill="${T.textMuted}">${esc(diagram.subtitle)}</text>`;
  }

  const allRects = [];

  // Process swimlanes
  const lanes = diagram.lanes || [];
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    const lx = lane.x;
    const lw = lane.width;
    const bgIdx = li % T.swimlaneBg.length;
    const hdIdx = li % T.swimlaneHd.length;
    const bg = lane.bgColor || T.swimlaneBg[bgIdx];
    const hd = lane.headerColor || T.swimlaneHd[hdIdx];
    const num = lane.number || `\u2460`;

    // Draw lane background + header
    svg += `<rect x="${lx}" y="${LANE_TOP}" width="${lw}" height="${LANE_BOT - LANE_TOP}" rx="8" fill="${bg}" stroke="${T.border}" stroke-width="1"/>`;
    svg += swimlaneHeader(lx, LANE_TOP, lw, hd, lane.label, num);

    // Process columns within lane
    const columns = lane.columns || [{ nodes: lane.nodes, distribution: lane.distribution }];
    for (const col of columns) {
      const nodes = col.nodes || [];
      if (nodes.length === 0) continue;

      const colX = (col.x != null ? col.x : lx) + PAD;
      const colW = (col.width || lw) - PAD * 2;
      const dist = col.distribution || 'even';

      let nodeYs;
      if (dist === 'compact-top') {
        nodeYs = distributeCompact(CONTENT_TOP, nodes.length, NODE_H, GAP);
      } else if (dist === 'compact-bottom') {
        const totalH = nodes.length * NODE_H + (nodes.length - 1) * GAP;
        nodeYs = distributeCompact(LANE_BOT - totalH, nodes.length, NODE_H, GAP);
      } else {
        nodeYs = distributeEvenly(CONTENT_TOP, AVAIL, nodes.length, NODE_H);
      }

      // Section frame
      if (col.frame) {
        svg += sectionFrame(colX - 6, nodeYs[0] - 10, colW + 12,
          nodeYs[nodes.length - 1] + NODE_H - nodeYs[0] + 24,
          col.frame.label, col.frame.color);
      }

      for (let ni = 0; ni < nodes.length; ni++) {
        const n = nodes[ni];
        const palette = PALETTES[n.palette] || PALETTES.generic;
        const badge = n.badge ? { label: n.badge.label, bg: n.badge.bg || '#2E7D32', color: n.badge.color || '#A5D6A7' } : null;
        svg += nodeBox(colX, nodeYs[ni], colW, NODE_H, palette, n.logo, n.name, n.subtitle, n.tag, badge);
        allRects.push({ id: n.name, x: colX, y: nodeYs[ni], w: colW, h: NODE_H });
      }

      // Vertical arrows between consecutive nodes in column
      if (col.arrows !== false) {
        const arrowLabels = col.arrowLabels || [];
        for (let i = 0; i < nodes.length - 1; i++) {
          const arrowType = (col.arrowType === 'auth') ? authArrow : dataArrow;
          svg += arrowType(colX + colW / 2, nodeYs[i] + NODE_H, colX + colW / 2, nodeYs[i + 1], arrowLabels[i] || null);
        }
      }
    }
  }

  // Custom arrows
  const customArrows = diagram.arrows || [];
  for (const a of customArrows) {
    const arrowFn = a.type === 'auth' ? authArrow : a.type === 'curved' ? curvedArrow : dataArrow;
    if (a.type === 'curved') {
      svg += curvedArrow(a.x1, a.y1, a.x2, a.y2, a.color || T.dataArrow, a.opacity || 0.6);
    } else {
      svg += arrowFn(a.x1, a.y1, a.x2, a.y2, a.label);
    }
    if (a.label && a.type === 'curved') {
      svg += arrowLabel((a.x1 + a.x2) / 2, Math.min(a.y1, a.y2) - 16, a.label, a.color || T.dataArrow);
    }
  }

  // Overlap check
  const overlaps = checkOverlap(allRects);
  if (overlaps.length) {
    console.error(`  OVERLAP in ${diagram.name}:`);
    overlaps.forEach(e => console.error(`    ${e}`));
    process.exit(1);
  }
  console.log(`  Layout OK: ${allRects.length} nodes, 0 overlaps`);

  // Legend + footer
  svg += legendBlock(20, LEGEND_TOP, W - 40);
  const org = diagram.org || 'NFG';
  svg += `<text x="${W - 12}" y="${H - 6}" text-anchor="end" font-family="${T.font}" font-size="10" fill="#263238">Generated by ${esc(org)} · ${new Date().toISOString().split('T')[0]}</text>`;

  return wrapSvg(W, H, svg);
}

// ═══════════════════════════════════════════════════════════════════════════
// PNG EXPORT
// ═══════════════════════════════════════════════════════════════════════════
async function renderPNG(svgPath, pngPath, width, height) {
  const { chromium } = require('playwright');
  const svgContent = fs.readFileSync(svgPath, 'utf-8');
  const html = `<!DOCTYPE html><html><head><style>body{margin:0;background:${T.bg};display:inline-block;}</style></head><body>${svgContent}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: width + 40, height: height + 40 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  const svgEl = await page.$('svg');
  await svgEl.screenshot({ path: pngPath, type: 'png' });
  await browser.close();
  console.log(`  PNG: ${path.basename(pngPath)} (${(fs.statSync(pngPath).size / 1024).toFixed(1)} KB)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const diagrams = Array.isArray(config) ? config : [config];
  const outDir = path.resolve(OUT_DIR);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Rendering ${diagrams.length} diagram(s)...\n`);
  loadAllLogos();

  for (const d of diagrams) {
    console.log(`\n  ${d.name}:`);
    const svgStr = buildFromConfig(d);
    const svgPath = path.join(outDir, `${d.name}.svg`);
    fs.writeFileSync(svgPath, svgStr);
    console.log(`  SVG: ${d.name}.svg (${(Buffer.byteLength(svgStr) / 1024).toFixed(1)} KB)`);

    if (RENDER_PNG) {
      try {
        await renderPNG(svgPath, path.join(outDir, `${d.name}.png`), d.width || 1600, d.height || 1100);
      } catch (err) {
        console.error(`  PNG failed: ${err.message}`);
      }
    }
  }
  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });
