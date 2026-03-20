// scrape-gdoc.js — Deep scrape Google Docs with proper content extraction
// Usage: node scrape-gdoc.js <index>  (0 = main onboarding, 1 = design template)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output', 'onboarding-content');
const PROFILE_DIR = path.join(__dirname, 'output', '.browser-profile');

const DOCS = [
  { name: '01-main-onboarding-doc', url: 'https://docs.google.com/document/d/1yOj0K7cbgGXVp7ppfmhT7Mel2QPTXRgfGlQvy9jy4ew/edit?pli=1&tab=t.0' },
  { name: '02-design-doc-template', url: 'https://docs.google.com/document/d/19XfMtEVeuVDQ1aRLS88SpBYKTyRBWRQS628KL4lOpno/edit?usp=sharing' }
];

(async () => {
  const idx = parseInt(process.argv[2] || '0', 10);
  const entry = DOCS[idx];
  if (!entry) { console.log('Usage: node scrape-gdoc.js <0|1>'); process.exit(1); }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Opening: ${entry.name}\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1400, height: 4000 },
    locale: 'en-US'
  });

  const page = await context.newPage();
  await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('Page loaded, waiting 15s for doc canvas...');
  await page.waitForTimeout(15000);

  // Scroll down to load all content (Google Docs lazy-loads)
  console.log('Scrolling through document...');
  let previousHeight = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1000);
    const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (currentHeight === previousHeight) break;
    previousHeight = currentHeight;
  }
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);

  // Extract content from the Google Docs editor
  const content = await page.evaluate(() => {
    // Google Docs renders in .kix-appview-editor or .docs-editor
    const editor = document.querySelector('.kix-appview-editor') 
      || document.querySelector('.docs-editor')
      || document.querySelector('[role="textbox"]');
    if (editor) return editor.innerText;

    // Fallback: try all paragraphs in the doc
    const paras = document.querySelectorAll('.kix-paragraphrenderer');
    if (paras.length > 0) {
      return Array.from(paras).map(p => p.innerText).join('\n');
    }

    // Last fallback
    return document.body.innerText;
  });

  // Screenshot
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${entry.name}.png`), fullPage: true });

  // Save
  const textPath = path.join(OUTPUT_DIR, `${entry.name}.txt`);
  fs.writeFileSync(textPath, `URL: ${entry.url}\nDate: ${new Date().toISOString()}\nChars: ${content.length}\n\n---\n\n${content}`);
  console.log(`\nSaved: ${content.length} chars to ${entry.name}.txt`);

  await context.close();
})();
