/**
 * scrape-one-by-one.js — Open each URL one at a time, wait for user to authenticate,
 * then capture content. Browser stays open so session cookies persist across URLs.
 *
 * Usage: node scrape-one-by-one.js [startIndex]
 *   startIndex: 0-based index to start from (default: 0). Use to resume.
 *
 * Flow per URL:
 *  1. Navigate to URL
 *  2. Wait 3s for initial load
 *  3. Check if page has meaningful content (not a login wall)
 *  4. If login wall detected → pause with countdown, let user authenticate
 *  5. After user authenticates (or timeout), capture content + screenshot
 *  6. Save to output/ and move to next URL
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URLS = [
  { name: '01-main-onboarding-doc', url: 'https://docs.google.com/document/d/1yOj0K7cbgGXVp7ppfmhT7Mel2QPTXRgfGlQvy9jy4ew/edit?pli=1&tab=t.0', type: 'google-doc' },
  { name: '02-design-doc-template', url: 'https://docs.google.com/document/d/19XfMtEVeuVDQ1aRLS88SpBYKTyRBWRQS628KL4lOpno/edit?usp=sharing', type: 'google-doc' },
  { name: '03-miro-newum-board', url: 'https://miro.com/app/board/uXjVGVycF3Y=/', type: 'miro' },
  { name: '04-miro-rachel-board', url: 'https://miro.com/app/board/uXjVJUOanb0=/?moveToWidget=3458764651332971013&cot=14', type: 'miro' },
  { name: '05-azure-devops-newum', url: 'https://dev.azure.com/oncologyanalytics/newUM', type: 'azure' },
  { name: '06-atlassian-sprint-planning', url: 'https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM/pages/5140905985/2+Sprint+Planning+-+NewUM', type: 'atlassian' },
  { name: '07-sharepoint-raid', url: 'https://oncologyanalyticsinc.sharepoint.com/:x:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/newUM_RAID.xlsx?d=w2dea0b03cf3c4e6ab0213a70c77834bf&csf=1&web=1&e=34bSYZ', type: 'sharepoint' },
  { name: '08-sharepoint-change-request', url: 'https://oncologyanalyticsinc.sharepoint.com/:w:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/NewUM_Change%20Request.docx?d=w490ff8ed484b4e358d8669d9ea4360ec&csf=1&web=1&e=cvAcbB', type: 'sharepoint' },
  { name: '09-databricks-dev', url: 'https://adb-2393860672770324.4.azuredatabricks.net/', type: 'databricks' },
];

const OUT_DIR = path.join(__dirname, 'output', 'onboarding-content');
const LOGIN_PATTERNS = [
  'Sign In',
  'sign in',
  'Remember me',
  'Need help signing in',
  'Enter your password',
  'Pick an account',
  'Okta Verify',
  'Enter your email',
  'Log in to continue',
  'Sign up for free',
  'This is a private board',
];

const WAIT_FOR_AUTH_SECONDS = 120; // 2 minutes per URL
const POLL_INTERVAL_MS = 3000; // check every 3s if user authenticated

function isLoginWall(text) {
  const matches = LOGIN_PATTERNS.filter(p => text.includes(p));
  return { isLogin: matches.length >= 1, patterns: matches };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function captureUrl(page, urlInfo, index) {
  const { name, url, type } = urlInfo;
  const result = {
    name,
    url,
    type,
    access: 'UNKNOWN',
    rootCause: null,
    chars: 0,
    loginPatterns: [],
    finalUrl: null,
    timestamp: new Date().toISOString(),
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${index + 1}/9] ${name}`);
  console.log(`URL: ${url}`);
  console.log(`Type: ${type}`);
  console.log('='.repeat(60));

  try {
    // Navigate
    console.log('  → Navigating...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000); // let JS render

    result.finalUrl = page.url();
    let bodyText = await page.innerText('body').catch(() => '');
    let { isLogin, patterns } = isLoginWall(bodyText);
    result.loginPatterns = patterns;

    if (isLogin) {
      console.log(`  ⚠ LOGIN WALL DETECTED: ${patterns.join(', ')}`);
      console.log(`  ⏳ Waiting up to ${WAIT_FOR_AUTH_SECONDS}s for you to authenticate...`);
      console.log(`  👉 Please log in on the browser window. I'll check every ${POLL_INTERVAL_MS / 1000}s.`);

      const startTime = Date.now();
      let authenticated = false;

      while (Date.now() - startTime < WAIT_FOR_AUTH_SECONDS * 1000) {
        await sleep(POLL_INTERVAL_MS);
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        // Re-check page content
        bodyText = await page.innerText('body').catch(() => '');
        const recheck = isLoginWall(bodyText);

        if (!recheck.isLogin) {
          console.log(`  ✅ Authentication detected after ${elapsed}s! Capturing content...`);
          authenticated = true;
          break;
        }

        // Check if URL changed (redirect after login)
        const currentUrl = page.url();
        if (currentUrl !== result.finalUrl) {
          console.log(`  🔄 URL changed to: ${currentUrl}`);
          result.finalUrl = currentUrl;
          await sleep(3000); // let new page load
          bodyText = await page.innerText('body').catch(() => '');
          const recheck2 = isLoginWall(bodyText);
          if (!recheck2.isLogin) {
            console.log(`  ✅ Redirected and authenticated after ${elapsed}s!`);
            authenticated = true;
            break;
          }
        }

        const remaining = WAIT_FOR_AUTH_SECONDS - elapsed;
        if (remaining > 0 && remaining % 15 === 0) {
          console.log(`  ⏳ ${remaining}s remaining...`);
        }
      }

      if (!authenticated) {
        console.log(`  ❌ Timeout — still on login wall after ${WAIT_FOR_AUTH_SECONDS}s`);
        result.access = 'NO';
        result.rootCause = `LOGIN_WALL: ${patterns.join(', ')}`;
      }
    }

    // Final capture
    await sleep(2000);
    bodyText = await page.innerText('body').catch(() => '');
    result.chars = bodyText.length;

    // Determine access
    const finalCheck = isLoginWall(bodyText);
    if (!finalCheck.isLogin && bodyText.length > 500) {
      result.access = 'YES';
      result.rootCause = 'ACCESSIBLE';
      console.log(`  ✅ GOT CONTENT: ${bodyText.length} chars`);
    } else if (result.access === 'UNKNOWN') {
      result.access = 'NO';
      if (bodyText.length < 100) {
        result.rootCause = 'EMPTY_PAGE';
      } else if (finalCheck.isLogin) {
        result.rootCause = `LOGIN_WALL: ${finalCheck.patterns.join(', ')}`;
      } else {
        result.rootCause = `PARTIAL_CONTENT: ${bodyText.length} chars`;
      }
      console.log(`  ❌ NO ACCESS: ${result.rootCause}`);
    }

    // Save text
    const textPath = path.join(OUT_DIR, `${name}.txt`);
    const header = `URL: ${url}\nFinal URL: ${result.finalUrl}\nDate: ${result.timestamp}\nType: ${type}\nAccess: ${result.access}\nRoot Cause: ${result.rootCause}\nChars: ${bodyText.length}\n\n---\n\n`;
    fs.writeFileSync(textPath, header + bodyText, 'utf8');

    // Save screenshot
    const pngPath = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: pngPath, fullPage: false });

    console.log(`  📁 Saved: ${textPath}`);
    console.log(`  📸 Screenshot: ${pngPath}`);

  } catch (err) {
    result.access = 'ERROR';
    result.rootCause = `ERROR: ${err.message}`;
    console.log(`  ❌ ERROR: ${err.message}`);

    // Still try to capture what we can
    try {
      const bodyText = await page.innerText('body').catch(() => '');
      if (bodyText.length > 0) {
        const textPath = path.join(OUT_DIR, `${name}.txt`);
        fs.writeFileSync(textPath, `ERROR: ${err.message}\n\n---\n\n${bodyText}`, 'utf8');
      }
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  return result;
}

async function main() {
  const startIndex = parseInt(process.argv[2] || '0', 10);
  console.log(`\n🚀 Starting one-by-one scrape from index ${startIndex}`);
  console.log(`📁 Output: ${OUT_DIR}`);
  console.log(`⏳ Auth timeout per URL: ${WAIT_FOR_AUTH_SECONDS}s`);
  console.log(`\n⚠ IMPORTANT: A browser window will open. When you see a login page,`);
  console.log(`  please authenticate manually. The script will detect when you're logged in.\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Launch visible browser (headed mode)
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const results = [];

  for (let i = startIndex; i < URLS.length; i++) {
    const result = await captureUrl(page, URLS[i], i);
    results.push(result);

    // Save running inventory
    const inventoryPath = path.join(OUT_DIR, '_inventory.json');
    fs.writeFileSync(inventoryPath, JSON.stringify(results, null, 2));

    // Brief pause between URLs
    if (i < URLS.length - 1) {
      console.log(`\n  ⏸ Moving to next URL in 3s...`);
      await sleep(3000);
    }
  }

  // Final summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));
  for (const r of results) {
    const icon = r.access === 'YES' ? '✅' : r.access === 'ERROR' ? '💥' : '❌';
    console.log(`${icon} ${r.name}: ${r.access} — ${r.rootCause} (${r.chars} chars)`);
  }
  console.log('='.repeat(60));

  const accessible = results.filter(r => r.access === 'YES').length;
  console.log(`\nAccessible: ${accessible}/${results.length}`);

  // Save final inventory
  fs.writeFileSync(path.join(OUT_DIR, '_inventory.json'), JSON.stringify(results, null, 2));

  await browser.close();
  console.log('\n🏁 Done. Browser closed.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
