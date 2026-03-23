const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SESSION_DIR = path.join(ROOT_DIR, '.playwright-session-okta');
const OUT_DIR = path.join(ROOT_DIR, 'clients', 'oncohealth', 'output');

// Load .env
const envPath = path.join(ROOT_DIR, 'clients', 'oncohealth', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const EMAIL = process.env.MS_USERNAME || '';
const PASSWORD = process.env.MS_PASSWORD || '';
const OKTA_USER = process.env.OKTA_USERNAME || '';
const BOARD_URL = 'https://miro.com/app/board/uXjVJUOanb0=/';

(async () => {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    slowMo: 200,
    channel: 'msedge',
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // Step 1: Go to Miro login page
  console.log('Step 1: Navigating to Miro login...');
  await page.goto('https://miro.com/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Debug: log page content
  const pageText = await page.evaluate(() => document.body?.innerText || '');
  console.log(`Login page text (first 500 chars):\n${pageText.substring(0, 500)}`);
  console.log(`URL: ${page.url()}`);
  
  // Take screenshot of login page
  await page.screenshot({ path: path.join(OUT_DIR, 'miro-login-page.png') });
  console.log('Screenshot: miro-login-page.png');

  // Step 2: Handle cookie consent and click Microsoft SSO
  console.log('\nStep 2: Handling cookie consent and clicking Microsoft SSO...');
  
  // Accept cookies first — try multiple selectors
  try {
    const cookieBtn = await page.$('text=Accept All Cookies')
      || await page.$('button:has-text("Accept")')
      || await page.$('[id*="accept"]');
    if (cookieBtn) {
      await cookieBtn.click({ force: true });
      console.log('  Accepted cookies');
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    console.log('  Cookie banner not found or already dismissed');
  }
  
  // Debug: list all clickable elements on the page
  const pageElements = await page.evaluate(() => {
    const els = document.querySelectorAll('button, a, [role="button"], input[type="submit"]');
    return Array.from(els).map((el, i) => ({
      i,
      tag: el.tagName,
      text: el.textContent?.trim().substring(0, 80),
      ariaLabel: el.getAttribute('aria-label') || '',
      testId: el.getAttribute('data-testid') || '',
      className: el.className?.toString().substring(0, 100) || '',
      visible: el.offsetParent !== null,
      rect: el.getBoundingClientRect(),
    })).filter(e => e.visible);
  });
  console.log('  Visible clickable elements:');
  pageElements.forEach(e => {
    if (e.text || e.ariaLabel) console.log(`    [${e.i}] ${e.tag} "${e.text}" aria="${e.ariaLabel}" testId="${e.testId}"`);
  });
  
  // Try to find and click the Microsoft/Office 365 button by various methods
  let clicked = false;
  
  // Method 1: Click by data-testid
  for (const testId of ['mr-link-signin-signin-with-office365-1', 'signin-with-office365', 'office365']) {
    const btn = await page.$(`[data-testid="${testId}"]`);
    if (btn) {
      await btn.click({ force: true });
      console.log(`  Clicked by testId: ${testId}`);
      clicked = true;
      break;
    }
  }
  
  // Method 2: Click by aria-label containing Microsoft or Office
  if (!clicked) {
    const msBtn = await page.$('[aria-label*="Microsoft" i]') || await page.$('[aria-label*="Office" i]');
    if (msBtn) {
      await msBtn.click({ force: true });
      console.log('  Clicked by aria-label');
      clicked = true;
    }
  }
  
  // Method 3: Use evaluate to find and click the Microsoft button
  if (!clicked) {
    clicked = await page.evaluate(() => {
      // Look for links/buttons that go to Microsoft login
      const els = document.querySelectorAll('a[href*="office"], a[href*="microsoft"], button');
      for (const el of els) {
        const href = el.href || '';
        const text = el.textContent?.trim() || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        if (href.includes('office') || href.includes('microsoft') || 
            text.includes('Office') || text.includes('Microsoft') ||
            ariaLabel.includes('Office') || ariaLabel.includes('Microsoft')) {
          el.click();
          return true;
        }
      }
      // Last resort: find the pattern of SSO buttons (usually in a row)
      // The Microsoft one is typically the 3rd button after SSO, Google
      const socialBtns = document.querySelectorAll('[class*="social"] a, [class*="signin-method"] a, [class*="auth"] a');
      if (socialBtns.length >= 3) {
        socialBtns[2].click(); // 0=SSO, 1=Google, 2=Microsoft
        return true;
      }
      return false;
    });
    if (clicked) console.log('  Clicked via DOM evaluation');
  }
  
  if (!clicked) {
    console.log('  Could not find Microsoft button. Trying SSO button...');
    // Try the SSO button as alternative
    const ssoClicked = await page.evaluate(() => {
      const els = document.querySelectorAll('a, button');
      for (const el of els) {
        if (el.textContent?.trim() === 'SSO') {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (ssoClicked) {
      console.log('  Clicked SSO button');
      clicked = true;
    }
  }
  
  await page.waitForTimeout(5000);
  console.log(`  After click URL: ${page.url()}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'miro-login-after-ms-click.png') });

  // Step 3: Handle Microsoft SSO or Okta redirect
  const afterUrl = page.url();
  
  if (afterUrl.includes('microsoftonline') || afterUrl.includes('login.microsoft') || afterUrl.includes('login.live')) {
    console.log('\nStep 3: Microsoft login page detected!');
    
    // Wait for page to fully load
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    
    try {
      // Check for "Pick an account" page first
      const pickAccount = await page.evaluate(() => document.body?.innerText?.includes('Pick an account'));
      
      if (pickAccount) {
        console.log('  "Pick an account" page — clicking account tile...');
        // Click the account tile with the email
        const accountClicked = await page.evaluate((email) => {
          const tiles = document.querySelectorAll('[data-test-id], .table, [role="listbox"] > *, [role="option"]');
          for (const tile of tiles) {
            if (tile.textContent?.includes(email)) {
              tile.click();
              return true;
            }
          }
          // Fallback: find any clickable element with the email text
          const allEls = document.querySelectorAll('div, li, a, button');
          for (const el of allEls) {
            if (el.textContent?.includes(email) && el.offsetParent !== null) {
              el.click();
              return true;
            }
          }
          return false;
        }, EMAIL);
        
        if (accountClicked) {
          console.log(`  Clicked ${EMAIL} account tile`);
        } else {
          // Try Playwright text selector
          await page.click(`text=${EMAIL}`, { timeout: 5000 });
          console.log(`  Clicked ${EMAIL} via text selector`);
        }
        
        await page.waitForTimeout(5000);
      } else {
        // Regular email input page
        const msEmailInput = await page.$('input[type="email"], input[name="loginfmt"]');
        if (msEmailInput) {
          await msEmailInput.fill(EMAIL);
          await page.waitForTimeout(500);
          const nextBtn = await page.$('input[type="submit"], #idSIButton9');
          if (nextBtn) {
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
              nextBtn.click(),
            ]);
          }
          console.log(`  Entered email: ${EMAIL}, clicked Next`);
          await page.waitForTimeout(3000);
        }
      }
    } catch (e) {
      console.log(`  MS login step (may be OK): ${e.message?.substring(0, 80)}`);
    }
    
    const msUrl2 = page.url();
    console.log(`  URL after email: ${msUrl2}`);
    await page.screenshot({ path: path.join(OUT_DIR, 'miro-login-ms-step2.png') });
    
    // Check if federated to Okta
    if (msUrl2.includes('okta') || msUrl2.includes('sso.oncology')) {
      console.log('  Federated to Okta!');
      try {
        const oktaUser = await page.$('input[name="identifier"], input[name="username"], input#okta-signin-username');
        if (oktaUser) {
          await oktaUser.fill(OKTA_USER);
          const nextBtn = await page.$('input[type="submit"], button[type="submit"]');
          if (nextBtn) {
            await Promise.all([
              page.waitForNavigation({ timeout: 10000 }).catch(() => {}),
              nextBtn.click(),
            ]);
          }
          await page.waitForTimeout(3000);
        }
        const passInput = await page.$('input[type="password"]');
        if (passInput) {
          await passInput.fill(PASSWORD);
          const verifyBtn = await page.$('input[type="submit"], button[type="submit"]');
          if (verifyBtn) await verifyBtn.click();
          console.log('  Entered Okta creds');
          console.log('  ****************************************************');
          console.log('  *  APPROVE MFA PUSH ON YOUR PHONE NOW!              *');
          console.log('  *  Waiting 120 seconds for approval...              *');
          console.log('  ****************************************************');
          await page.waitForTimeout(120000);
        }
      } catch (e) {
        console.log(`  Okta error: ${e.message?.substring(0, 80)}`);
      }
    } else {
      // Microsoft password page
      try {
        await page.waitForSelector('input[type="password"], input[name="passwd"]', { timeout: 5000 }).catch(() => {});
        const passInput = await page.$('input[type="password"], input[name="passwd"]');
        if (passInput) {
          await passInput.fill(PASSWORD);
          const signInBtn = await page.$('input[type="submit"], #idSIButton9');
          if (signInBtn) {
            await Promise.all([
              page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
              signInBtn.click(),
            ]);
          }
          console.log('  Entered MS password');
          await page.waitForTimeout(3000);
        }
        
        // "Stay signed in?" prompt
        const stayBtn = await page.$('#idSIButton9, input[value="Yes"]');
        if (stayBtn) {
          await stayBtn.click();
          console.log('  Clicked "Stay signed in"');
          await page.waitForTimeout(3000);
        }
      } catch (e) {
        console.log(`  MS password error: ${e.message?.substring(0, 80)}`);
      }
    }
  } else if (afterUrl.includes('okta') || afterUrl.includes('sso.oncology')) {
    console.log('\nStep 3: Okta SSO detected!');
    const oktaUser = await page.$('input[name="identifier"], input[name="username"]');
    if (oktaUser) {
      await oktaUser.fill(OKTA_USER);
      const nextBtn = await page.$('input[type="submit"], button[type="submit"]');
      if (nextBtn) await nextBtn.click();
      await page.waitForTimeout(3000);
    }
    const passInput = await page.$('input[type="password"]');
    if (passInput) {
      await passInput.fill(PASSWORD);
      const verifyBtn = await page.$('input[type="submit"], button[type="submit"]');
      if (verifyBtn) await verifyBtn.click();
      console.log('  >>> APPROVE MFA PUSH! <<<');
      await page.waitForTimeout(30000);
    }
  } else {
    console.log(`  Not redirected to SSO. Current URL: ${afterUrl}`);
  }
  
  // Step 5: Wait and check final state
  console.log('\nStep 5: Checking login result...');
  await page.waitForTimeout(3000);
  const finalUrl = page.url();
  console.log(`Final URL: ${finalUrl}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'miro-login-final.png') });
  
  // Step 6: Navigate to the board
  console.log('\nStep 6: Navigating to board...');
  await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(10000);
  
  const boardUrl = page.url();
  const boardTitle = await page.title();
  const boardText = await page.evaluate(() => document.body?.innerText || '');
  console.log(`Board URL: ${boardUrl}`);
  console.log(`Board title: ${boardTitle}`);
  console.log(`Board text length: ${boardText.length}`);
  console.log(`First 300 chars: ${boardText.substring(0, 300)}`);
  
  // Check for login wall
  const loginPatterns = ['Sign up', 'Sign in', 'Log in', 'This is a private board'];
  const foundLogin = loginPatterns.filter(p => boardText.includes(p));
  
  if (foundLogin.length === 0 || boardText.length > 500) {
    console.log('\n✅ Miro board loaded!');
    
    // Take screenshot
    await page.screenshot({ path: path.join(OUT_DIR, '03-miro-newum-board.png') });
    console.log('Screenshot saved: 03-miro-newum-board.png');
    
    // Extract text
    const allText = await page.evaluate(() => {
      const texts = [];
      const body = document.body?.innerText || '';
      if (body.length > 50) texts.push('=== BODY TEXT ===\n' + body);
      const textEls = document.querySelectorAll('span, p, div, h1, h2, h3, h4, h5, h6, a, button, label');
      const uniqueTexts = new Set();
      textEls.forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length > 2 && t.length < 500 && !uniqueTexts.has(t)) uniqueTexts.add(t);
      });
      if (uniqueTexts.size > 0) texts.push('=== TEXT ELEMENTS ===\n' + Array.from(uniqueTexts).join('\n'));
      const ariaEls = document.querySelectorAll('[aria-label]');
      const ariaLabels = Array.from(ariaEls).map(el => el.getAttribute('aria-label')).filter(Boolean);
      if (ariaLabels.length > 0) texts.push('=== ARIA LABELS ===\n' + ariaLabels.join('\n'));
      return texts.join('\n\n');
    });
    
    fs.writeFileSync(path.join(OUT_DIR, '03-miro-newum-board.txt'), allText, 'utf-8');
    console.log(`Text saved: ${allText.length} chars`);
  } else {
    console.log(`\n❌ Still showing login wall: ${foundLogin.join(', ')}`);
    await page.screenshot({ path: path.join(OUT_DIR, '03-miro-newum-board-failed.png') });
  }
  
  console.log('\nDone. Browser staying open 30s...');
  await page.waitForTimeout(30000);
  await context.close();
})();
