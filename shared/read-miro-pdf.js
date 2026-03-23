#!/usr/bin/env node
// Extract text from Miro PDF export — with spaced-character cleanup
const fs = require('fs');
const path = require('path');
const { PdfReader } = require('pdfreader');

const pdfPath = process.argv[2] || path.join(process.env.USERPROFILE, 'Downloads', 'NewUM.pdf');
const outDir = path.join(__dirname, '..', 'clients', 'oncohealth', 'output');

console.log(`Reading: ${pdfPath}`);
const stat = fs.statSync(pdfPath);
console.log(`File size: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

// Collapse spaced-out text: "R i s k s" → "Risks"
function cleanSpacedText(text) {
  // Miro PDF exports individual characters with spaces between them
  // Detect: more than 50% of chars are single-char followed by space
  const chars = text.split('');
  let singleCharSpacePattern = 0;
  for (let i = 0; i < chars.length - 1; i += 2) {
    if (chars[i] !== ' ' && chars[i + 1] === ' ') singleCharSpacePattern++;
  }
  
  // If more than 40% of character pairs match the pattern, collapse
  if (text.length > 3 && singleCharSpacePattern > (text.length / 4)) {
    // Remove spaces between individual characters but preserve word breaks
    // "H e l l o   W o r l d" → "Hello World"  
    // Strategy: remove single spaces between single chars, keep double+ spaces as word breaks
    let result = text
      .replace(/([^\s])\s([^\s])(?=\s[^\s]|$)/g, '$1$2')  // collapse char-space-char patterns
      .replace(/([^\s])\s([^\s])(?=\s[^\s]|$)/g, '$1$2')  // run twice to catch remaining
      .replace(/([^\s])\s([^\s])(?=\s[^\s]|$)/g, '$1$2')  // and again
      .replace(/([^\s])\s([^\s])$/g, '$1$2');
    
    // Simpler approach: just remove all spaces, then re-add word boundaries
    // A word boundary in the spaced text appears as a double-space or more
    result = text
      .replace(/\s{2,}/g, '⏎')  // mark real word breaks (multiple spaces)
      .replace(/\s/g, '')         // remove single spaces
      .replace(/⏎/g, ' ');       // restore word breaks
    
    return result;
  }
  return text;
}

// Group text items into lines by Y position (within tolerance)
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
    // End of file
    const pageNums = Object.keys(pages).map(Number).sort((a,b) => a - b);
    console.log(`Pages: ${pageNums.length}`);
    console.log(`Total text items: ${totalItems}`);
    
    let fullText = '';
    for (const p of pageNums) {
      const lines = groupIntoLines(pages[p]);
      const lineTexts = lines.map(line => {
        const sorted = line.sort((a, b) => a.x - b.x);
        return sorted.map(i => cleanSpacedText(i.text)).join(' ').trim();
      }).filter(t => t.length > 0);
      
      fullText += `\n=== Page ${p} ===\n`;
      fullText += lineTexts.join('\n') + '\n';
    }
    
    // Show sample
    console.log(`\n--- First 5000 chars (cleaned) ---\n`);
    console.log(fullText.substring(0, 5000));
    
    const outPath = path.join(outDir, '03-miro-newum-board.txt');
    
    // Global post-processing: collapse spaced-out characters
    // Miro PDFs encode "Risks" as "R i s k s" — every char separated by single space
    // Real word boundaries are typically 2+ spaces
    let cleaned = fullText
      .split('\n')
      .map(line => {
        if (line.startsWith('=== Page')) return line;
        if (line.trim().length === 0) return '';
        // Replace double+ spaces with a placeholder
        return line
          .replace(/\s{3,}/g, '⏎')  // 3+ spaces = word break
          .replace(/\s{2}/g, '⏎')   // 2 spaces = word break  
          .replace(/\s/g, '')         // remove single spaces (they're between chars)
          .replace(/⏎/g, ' ')        // restore word breaks
          .trim();
      })
      .join('\n');
    
    fs.writeFileSync(outPath, cleaned, 'utf8');
    console.log(`\n--- Saved: ${outPath} (${cleaned.length} chars) ---`);
    
    // Also show cleaned preview
    console.log(`\n--- CLEANED First 5000 chars ---\n`);
    console.log(cleaned.substring(0, 5000));
    return;
  }
  
  if (item.page) {
    currentPage = item.page;
    if (!pages[currentPage]) pages[currentPage] = [];
  }
  
  if (item.text) {
    totalItems++;
    pages[currentPage].push({ text: item.text, x: item.x, y: item.y });
  }
});
