const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MIRO_URLS = [
  { name: '03-miro-newum-board', url: 'https://miro.com/app/board/uXjVGVycF3Y=/' },
  { name: '04-miro-rachel-board', url: 'https://miro.com/app/board/uXjVJUOanb0=/?moveToWidget=3458764651332971013&cot=14' },
];

const OUT_DIR = path.join(__dirname, 'output', 'onboarding-content');

// Which Miro to start with (0-based index)
const START = parseInt(process.argv[2] || '0', 10);

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const entry = MIRO_URLS[START];
  if (!entry) {
    console.log(`Invalid index ${START}. Valid: 0-${MIRO_URLS.length - 1}`);
    await browser.close();
    return;
  }

  console.log(`\n========================================`);
  console.log(`  Opening: ${entry.name}`);
  console.log(`  URL: ${entry.url}`);
  console.log(`========================================`);
  console.log(`\n>>> You have 2 MINUTES to log in / authenticate.`);
  console.log(`>>> The script will auto-check every 10 seconds.`);
  console.log(`>>> Once content is detected, it will capture and save.\n`);

  await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Poll every 10 seconds for up to 2 minutes
  let captured = false;
  for (let attempt = 1; attempt <= 12; attempt++) {
    await page.waitForTimeout(10000);

    const currentUrl = page.url();
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const chars = bodyText.length;

    console.log(`[Check ${attempt}/12] ${chars} chars | URL: ${currentUrl.substring(0, 80)}...`);
    console.log(`  Title: ${title}`);

    // Check for login walls
    const loginPatterns = ['Sign up', 'Sign in', 'Log in', 'This is a private board', 'Enter your work email'];
    const foundLogin = loginPatterns.filter(p => bodyText.includes(p));
    if (foundLogin.length > 0) {
      console.log(`  ⚠️  Login wall detected: ${foundLogin.join(', ')}`);
      console.log(`  >>> Please log in in the browser window...`);
      continue;
    }

    // Check if we have real content (Miro boards may render as canvas)
    // Miro uses canvas heavily, so innerText may be minimal even when loaded
    // Let's also check for Miro-specific elements
    const miroInfo = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      const iframes = document.querySelectorAll('iframe');
      const boardTitle = document.querySelector('[data-testid="board-title"]')?.textContent || '';
      const toolbar = document.querySelector('[class*="toolbar"]') ? true : false;
      const bottomBar = document.querySelector('[class*="bottom-bar"]') ? true : false;
      // Check if the board app is loaded
      const appLoaded = document.querySelector('#miro-app') || document.querySelector('[id*="board"]') || document.querySelector('.board');
      return {
        canvasCount: canvases.length,
        iframeCount: iframes.length,
        boardTitle,
        hasToolbar: toolbar,
        hasBottomBar: bottomBar,
        hasApp: !!appLoaded,
        bodyClasses: document.body.className.substring(0, 200),
        rootIds: Array.from(document.querySelectorAll('[id]')).slice(0, 20).map(el => el.id),
      };
    });

    console.log(`  Canvas: ${miroInfo.canvasCount} | iframes: ${miroInfo.iframeCount} | appLoaded: ${miroInfo.hasApp}`);
    console.log(`  Board title: "${miroInfo.boardTitle}" | toolbar: ${miroInfo.hasToolbar}`);
    console.log(`  Root IDs: ${miroInfo.rootIds.join(', ')}`);

    // Miro board is loaded if we see canvas elements and no login wall
    if (miroInfo.canvasCount > 0 || miroInfo.hasApp || miroInfo.hasToolbar) {
      console.log(`\n✅ Miro board appears to be loaded!`);

      // Take a high-quality screenshot
      const screenshotPath = path.join(OUT_DIR, `${entry.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`  Screenshot saved: ${screenshotPath}`);

      // Try to extract any text content available
      const allText = await page.evaluate(() => {
        // Try multiple strategies to get text from Miro
        const texts = [];
        
        // 1. Regular text nodes
        const body = document.body?.innerText || '';
        if (body.length > 50) texts.push('=== BODY TEXT ===\n' + body);

        // 2. All visible text elements
        const textEls = document.querySelectorAll('span, p, div, h1, h2, h3, h4, h5, h6, a, button, label');
        const uniqueTexts = new Set();
        textEls.forEach(el => {
          const t = el.textContent?.trim();
          if (t && t.length > 2 && t.length < 500 && !uniqueTexts.has(t)) {
            uniqueTexts.add(t);
          }
        });
        if (uniqueTexts.size > 0) texts.push('=== TEXT ELEMENTS ===\n' + Array.from(uniqueTexts).join('\n'));

        // 3. All aria labels
        const ariaEls = document.querySelectorAll('[aria-label]');
        const ariaLabels = Array.from(ariaEls).map(el => el.getAttribute('aria-label')).filter(Boolean);
        if (ariaLabels.length > 0) texts.push('=== ARIA LABELS ===\n' + ariaLabels.join('\n'));

        // 4. Title and meta
        const title = document.title;
        const meta = Array.from(document.querySelectorAll('meta[name], meta[property]'))
          .map(m => `${m.getAttribute('name') || m.getAttribute('property')}: ${m.getAttribute('content')}`)
          .filter(Boolean);
        if (meta.length > 0) texts.push('=== META ===\n' + `Title: ${title}\n` + meta.join('\n'));

        return texts.join('\n\n');
      });

      const txtPath = path.join(OUT_DIR, `${entry.name}.txt`);
      fs.writeFileSync(txtPath, allText, 'utf-8');
      console.log(`  Text saved: ${txtPath} (${allText.length} chars)`);

      captured = true;
      break;
    }

    // If it's been 60 seconds and still nothing, take a diagnostic screenshot
    if (attempt === 6) {
      const diagPath = path.join(OUT_DIR, `${entry.name}-diagnostic.png`);
      await page.screenshot({ path: diagPath, fullPage: false });
      console.log(`  📸 Diagnostic screenshot saved: ${diagPath}`);
    }
  }

  if (!captured) {
    console.log(`\n❌ Could not capture ${entry.name} after 2 minutes.`);
    // Save whatever we have
    const finalText = await page.evaluate(() => document.body?.innerText || '');
    const txtPath = path.join(OUT_DIR, `${entry.name}.txt`);
    fs.writeFileSync(txtPath, finalText, 'utf-8');
    console.log(`  Saved final state: ${txtPath} (${finalText.length} chars)`);
    
    const screenshotPath = path.join(OUT_DIR, `${entry.name}-final.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`  Final screenshot: ${screenshotPath}`);
  }

  console.log(`\n>>> Done with ${entry.name}. Browser will stay open 30 more seconds...`);
  await page.waitForTimeout(30000);
  await browser.close();
})();
