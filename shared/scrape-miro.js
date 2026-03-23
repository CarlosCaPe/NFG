const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --client flag support
const args = process.argv.slice(2);
const clientIdx = args.indexOf('--client');
const CLIENT = clientIdx !== -1 ? args[clientIdx + 1] : null;
const ROOT_DIR = path.resolve(__dirname, '..');

const MIRO_URLS = [
  { name: '03-miro-newum-board', url: 'https://miro.com/app/board/uXjVJUOanb0=/' },
];

// Output dir: clients/<client>/output/ if --client, else shared/output/
const OUT_DIR = CLIENT
  ? path.join(ROOT_DIR, 'clients', CLIENT, 'output')
  : path.join(__dirname, 'output', 'onboarding-content');

// Which Miro to start with (0-based index from positional args)
const positionalArgs = args.filter((a, i) => a !== '--client' && (clientIdx === -1 || i !== clientIdx + 1));
const START = parseInt(positionalArgs[0] || '0', 10);

// Persistent session dir — reuse Okta session (has SSO cookies)
const SESSION_DIR = path.join(ROOT_DIR, '.playwright-session-okta');

(async () => {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    slowMo: 100,
    channel: 'msedge',
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const entry = MIRO_URLS[START];
  if (!entry) {
    console.log(`Invalid index ${START}. Valid: 0-${MIRO_URLS.length - 1}`);
    await context.close();
    return;
  }

  console.log(`\n========================================`);
  console.log(`  Opening: ${entry.name}`);
  console.log(`  URL: ${entry.url}`);
  console.log(`========================================`);
  console.log(`\n>>> Attempting Miro SSO login with Okta session...`);
  console.log(`>>> Then loading board. You have 3 MINUTES to authenticate if needed.`);
  console.log(`>>> The script will auto-check every 10 seconds.\n`);

  // Load .env for credentials
  const envPath = CLIENT
    ? path.join(ROOT_DIR, 'clients', CLIENT, '.env')
    : path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    });
  }
  const OKTA_USER = process.env.OKTA_USERNAME || process.env.MS_USERNAME || '';
  const OKTA_PASS = process.env.MS_PASSWORD || '';
  const MIRO_EMAIL = process.env.MS_USERNAME || OKTA_USER;
  console.log(`Using email: ${MIRO_EMAIL}`);

  // Step 1: Navigate to board URL directly — Miro will show login wall
  await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Step 2: Try to automate login if we see the login wall
  let loginAttempted = false;
  const tryLogin = async () => {
    if (loginAttempted) return;
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    if (!bodyText.includes('Sign in') && !bodyText.includes('Log in') && !bodyText.includes('Sign up')) return;
    
    console.log('>>> Attempting automated Miro login...');
    loginAttempted = true;

    // Look for "Sign in" link/button and click it
    const signInClicked = await page.evaluate(() => {
      // Try various selectors for the sign-in link
      const links = document.querySelectorAll('a, button');
      for (const el of links) {
        const text = el.textContent?.trim();
        if (text === 'Sign in' || text === 'Log in' || text === 'Sign in to view') {
          el.click();
          return true;
        }
      }
      return false;
    });

    if (signInClicked) {
      console.log('  Clicked "Sign in" — waiting for login page...');
      await page.waitForTimeout(3000);
    } else {
      // Try navigating to Miro login directly
      console.log('  No sign-in button found, navigating to login page...');
      await page.goto('https://miro.com/login/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
    }

    // Try to enter email and submit
    const currentUrl = page.url();
    console.log(`  Login page: ${currentUrl}`);
    
    // Look for email input field
    const emailInput = await page.$('input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="email" i], input[placeholder*="Email" i]');
    if (emailInput && MIRO_EMAIL) {
      console.log(`  Entering email: ${MIRO_EMAIL}`);
      await emailInput.fill(MIRO_EMAIL);
      await page.waitForTimeout(500);
      
      // Look for continue/submit button
      const submitBtn = await page.$('button[type="submit"], button[data-testid*="submit"], button[data-testid*="continue"]');
      if (submitBtn) {
        await submitBtn.click();
        console.log('  Clicked continue/submit — waiting for SSO redirect...');
      } else {
        await page.keyboard.press('Enter');
        console.log('  Pressed Enter — waiting for SSO redirect...');
      }
      await page.waitForTimeout(5000);
      
      // Check if we're at Okta SSO
      const ssoUrl = page.url();
      console.log(`  Current URL after email: ${ssoUrl}`);
      
      if (ssoUrl.includes('okta') || ssoUrl.includes('sso')) {
        console.log('  Okta SSO detected — checking if session handles it...');
        // The Okta session cookies should handle this
        // Check for username/password fields
        const usernameInput = await page.$('input[name="identifier"], input[name="username"], input#okta-signin-username');
        if (usernameInput) {
          console.log('  Entering Okta credentials...');
          await usernameInput.fill(OKTA_USER.includes('@') ? OKTA_USER.split('@')[0] : OKTA_USER);
          await page.waitForTimeout(500);
          const nextBtn = await page.$('input[type="submit"], button[type="submit"]');
          if (nextBtn) await nextBtn.click();
          await page.waitForTimeout(3000);
          
          const passInput = await page.$('input[type="password"], input[name="credentials.passcode"]');
          if (passInput && OKTA_PASS) {
            await passInput.fill(OKTA_PASS);
            await page.waitForTimeout(500);
            const verifyBtn = await page.$('input[type="submit"], button[type="submit"]');
            if (verifyBtn) await verifyBtn.click();
            console.log('  Submitted Okta password — waiting for MFA or redirect...');
            console.log('  >>> APPROVE THE OKTA MFA PUSH ON YOUR PHONE! <<<');
            await page.waitForTimeout(15000);
          }
        }
      }
      
      // After login flow, go back to board
      const afterLoginUrl = page.url();
      if (!afterLoginUrl.includes('board')) {
        console.log('  Navigating back to board...');
        await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
      }
    } else {
      console.log('  No email input found on login page');
    }
  };

  // Poll every 10 seconds for up to 3 minutes (18 checks)
  let captured = false;
  for (let attempt = 1; attempt <= 18; attempt++) {
    await page.waitForTimeout(10000);

    const currentUrl = page.url();
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const chars = bodyText.length;

    console.log(`[Check ${attempt}/18] ${chars} chars | URL: ${currentUrl.substring(0, 80)}...`);
    console.log(`  Title: ${title}`);

    // Check for login walls
    const loginPatterns = ['Sign up', 'Sign in', 'Log in', 'This is a private board', 'Enter your work email'];
    const foundLogin = loginPatterns.filter(p => bodyText.includes(p));
    if (foundLogin.length > 0) {
      console.log(`  ⚠️  Login wall detected: ${foundLogin.join(', ')}`);
      // Try automated login on first detection
      await tryLogin();
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

    // If it's been 90 seconds and still nothing, take a diagnostic screenshot
    if (attempt === 9) {
      const diagPath = path.join(OUT_DIR, `${entry.name}-diagnostic.png`);
      await page.screenshot({ path: diagPath, fullPage: false });
      console.log(`  📸 Diagnostic screenshot saved: ${diagPath}`);
    }
  }

  if (!captured) {
    console.log(`\n❌ Could not capture ${entry.name} after 3 minutes.`);
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
  await context.close();
})();
