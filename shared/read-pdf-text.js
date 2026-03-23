#!/usr/bin/env node
// Generic PDF text extraction using pdfreader
// Usage: node shared/read-pdf-text.js <input.pdf> [output.txt]
const fs = require('fs');
const path = require('path');
const { PdfReader } = require('pdfreader');

const pdfPath = process.argv[2];
const outPath = process.argv[3];

if (!pdfPath) {
  console.error('Usage: node read-pdf-text.js <input.pdf> [output.txt]');
  process.exit(1);
}

console.log(`Reading: ${pdfPath}`);
const stat = fs.statSync(pdfPath);
console.log(`File size: ${(stat.size / 1024).toFixed(1)} KB`);

function groupIntoLines(items, yTolerance = 0.5) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let currentLine = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentLine[0].y) <= yTolerance) {
      currentLine.push(sorted[i]);
    } else {
      lines.push(currentLine);
      currentLine = [sorted[i]];
    }
  }
  lines.push(currentLine);
  return lines;
}

const pages = {};
let currentPage = 0;
let totalItems = 0;

new PdfReader().parseFileItems(pdfPath, (err, item) => {
  if (err) { console.error('Error:', err); return; }

  if (!item) {
    const pageNums = Object.keys(pages).map(Number).sort((a, b) => a - b);
    console.log(`Pages: ${pageNums.length}, Text items: ${totalItems}`);

    let fullText = '';
    for (const p of pageNums) {
      const lines = groupIntoLines(pages[p]);
      const lineTexts = lines.map(line => {
        const sorted = line.sort((a, b) => a.x - b.x);
        return sorted.map(i => i.text).join(' ').trim();
      }).filter(t => t.length > 0);
      fullText += lineTexts.join('\n') + '\n\n';
    }

    // Collapse spaced-out characters (PDF exports each char separately)
    // "H e l l o   W o r l d" → "Hello World"
    // Single spaces = between chars, double+ spaces = word breaks
    fullText = fullText
      .split('\n')
      .map(line => {
        if (line.trim().length === 0) return '';
        return line
          .replace(/\s{3,}/g, '⏎')  // 3+ spaces = word break
          .replace(/\s{2}/g, '⏎')   // 2 spaces = word break
          .replace(/\s/g, '')         // remove single spaces (between chars)
          .replace(/⏎/g, ' ')        // restore word breaks
          .trim();
      })
      .join('\n');

    fullText = fullText.trim() + '\n';
    console.log(`Total chars: ${fullText.length}`);

    if (outPath) {
      fs.writeFileSync(outPath, fullText, 'utf8');
      console.log(`Saved: ${outPath}`);
    } else {
      console.log('\n--- Full text ---\n');
      console.log(fullText);
    }
    return;
  }

  if (item.page) {
    currentPage = item.page;
    if (!pages[currentPage]) pages[currentPage] = [];
  }
  if (item.text) {
    totalItems++;
    pages[currentPage].push({ x: item.x, y: item.y, text: item.text });
  }
});
