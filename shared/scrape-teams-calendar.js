/**
 * Teams & Calendar Scraper via Playwright + Okta SSO
 * 
 * Uses existing Okta SSO session from .playwright-session-okta
 * to access Teams Web and Outlook Calendar.
 * 
 * Commands:
 *   node scrape-teams-calendar.js calendar    — Scrape Outlook Calendar
 *   node scrape-teams-calendar.js teams       — Scrape Teams channels/chats
 *   node scrape-teams-calendar.js all         — Both
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'output', 'graph');
const SESSION_DIR = path.join(__dirname, '.playwright-session-okta');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const MS_EMAIL = process.env.MS_USERNAME;
const MS_PASS = process.env.MS_PASSWORD;
const OKTA_USER = MS_EMAIL ? MS_EMAIL.split('@')[0] : 'ccarrillo';

async function handleAuth(page, maxRounds = 15) {
  for (let round = 0; round < maxRounds; round++) {
    await page.waitForTimeout(2000);
    const url = page.url();
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');

    console.log(`  [Auth ${round}] ${url.substring(0, 70)}...`);

    // Microsoft login: enter email
    if (url.includes('login.microsoftonline.com')) {
      try {
        const emailField = await page.$('input[type="email"], input[name="loginfmt"]');
        if (emailField) {
          const val = await emailField.inputValue();
          if (!val) {
            console.log(`  → Filling Microsoft email: ${MS_EMAIL}`);
            await emailField.fill(MS_EMAIL);
            await page.waitForTimeout(500);
            await page.click('input[type="submit"]');
            await page.waitForTimeout(4000);
            continue;
          }
        }
      } catch (e) { /* ignore */ }

      // "Stay signed in?"
      try {
        const yesBtn = await page.$('input[value="Yes"]');
        if (yesBtn) {
          console.log('  → Clicking "Stay signed in? Yes"');
          await yesBtn.click();
          await page.waitForTimeout(3000);
          continue;
        }
      } catch (e) { /* ignore */ }

      // Password on Microsoft
      try {
        const passField = await page.$('input[type="password"][name="passwd"]');
        if (passField) {
          console.log('  → Filling Microsoft password');
          await passField.fill(MS_PASS);
          await page.waitForTimeout(500);
          await page.click('input[type="submit"]');
          await page.waitForTimeout(4000);
          continue;
        }
      } catch (e) { /* ignore */ }
    }

    // Okta SSO
    if (url.includes('sso.oncologyanalytics.com') || url.includes('okta.com')) {
      try {
        const userField = await page.$('#okta-signin-username, input[name="username"], input[name="identifier"]');
        if (userField) {
          const val = await userField.inputValue();
          if (!val) {
            console.log(`  → Filling Okta username: ${OKTA_USER}`);
            await userField.fill(OKTA_USER);
            await page.waitForTimeout(500);
          }
        }
      } catch (e) { /* ignore */ }

      try {
        const passField = await page.$('#okta-signin-password, input[name="password"], input[type="password"]');
        if (passField) {
          const val = await passField.inputValue();
          if (!val) {
            console.log('  → Filling Okta password');
            await passField.fill(MS_PASS);
            await page.waitForTimeout(500);
          }
        }
      } catch (e) { /* ignore */ }

      try {
        const submitBtn = await page.$('#okta-signin-submit, input[type="submit"], button[type="submit"]');
        if (submitBtn) {
          console.log('  → Clicking Sign In');
          await submitBtn.click();
          await page.waitForTimeout(5000);
          continue;
        }
      } catch (e) { /* ignore */ }

      // MFA / Okta Verify
      if (body.includes('Okta Verify') || body.includes('Send push') || body.includes('Push notification')) {
        try {
          const pushBtn = await page.$('input[value="Send Push"], button:has-text("Send Push"), a:has-text("Send Push")');
          if (pushBtn) {
            console.log('  → Clicking "Send Push"');
            await pushBtn.click();
          }
        } catch (e) { /* ignore */ }

        console.log('  📱 MFA: Approve Okta Verify push on your phone!');
        for (let i = 0; i < 12; i++) {
          await page.waitForTimeout(5000);
          const currentUrl = page.url();
          if (!currentUrl.includes('okta.com') && !currentUrl.includes('sso.oncologyanalytics.com')) {
            console.log('  ✅ MFA approved! Redirecting...');
            await page.waitForTimeout(3000);
            return true;
          }
          console.log(`  [${(i + 1) * 5}s] Waiting for MFA approval...`);
        }
        console.log('  ❌ MFA timeout');
        return false;
      }
    }

    // Check if loaded (no more auth)
    const noAuth = !url.includes('login') && !url.includes('okta') && !url.includes('sso.') && body.length > 200;
    if (noAuth) {
      console.log('  ✅ Authenticated and loaded!');
      return true;
    }
  }
  return false;
}

async function scrapeCalendar(context) {
  console.log('\n' + '═'.repeat(60));
  console.log('📅 OUTLOOK CALENDAR');
  console.log('═'.repeat(60));

  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto('https://outlook.office.com/calendar', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(`  Nav warning: ${e.message.substring(0, 60)}`);
  }

  await page.waitForTimeout(3000);
  const authed = await handleAuth(page);

  if (!authed) {
    console.log('  ❌ Calendar auth failed');
    return { success: false, chars: 0 };
  }

  // Wait for calendar to fully render
  console.log('  ⏳ Waiting for calendar to load...');
  await page.waitForTimeout(10000);

  // Take screenshot
  await page.screenshot({ path: path.join(OUT_DIR, 'calendar.png'), fullPage: false });
  console.log('  📸 calendar.png saved');

  // Try to switch to list/agenda view for better text extraction
  try {
    // Look for view switcher - agenda or list view
    const listBtn = await page.$('button[aria-label*="List"], button[aria-label*="Agenda"], button:has-text("Agenda")');
    if (listBtn) {
      console.log('  → Switching to Agenda view...');
      await listBtn.click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: path.join(OUT_DIR, 'calendar-agenda.png'), fullPage: false });
    }
  } catch (e) { /* ignore */ }

  // Extract all visible text
  const calText = await page.evaluate(() => {
    const texts = [];
    texts.push(`Title: ${document.title}`);
    texts.push(`URL: ${window.location.href}`);
    texts.push('');

    // Try to get event details from the calendar
    const events = document.querySelectorAll('[data-app-section="CalendarEvent"], [class*="event"], [class*="Event"], [role="listitem"], [class*="calendar-item"]');
    if (events.length > 0) {
      texts.push(`=== CALENDAR EVENTS (${events.length} visible) ===`);
      events.forEach((ev, i) => {
        const text = ev.innerText?.trim();
        if (text && text.length > 3) {
          texts.push(`\n--- Event ${i + 1} ---`);
          texts.push(text);
        }
      });
    }

    // Get all visible text as fallback
    const allText = document.body?.innerText || '';
    if (allText.length > 100) {
      texts.push('\n=== FULL PAGE TEXT ===');
      texts.push(allText);
    }

    // Get meta info
    const meta = Array.from(document.querySelectorAll('meta[name], meta[property]'))
      .map(m => `${m.getAttribute('name') || m.getAttribute('property')}: ${m.getAttribute('content')}`).filter(Boolean);
    if (meta.length) texts.push(`\n=== META ===\n${meta.join('\n')}`);

    return texts.join('\n');
  });

  fs.writeFileSync(path.join(OUT_DIR, 'calendar.txt'), calText, 'utf-8');
  console.log(`  📝 calendar.txt: ${calText.length} chars`);

  return { success: true, chars: calText.length };
}

async function scrapeTeams(context) {
  console.log('\n' + '═'.repeat(60));
  console.log('💬 MICROSOFT TEAMS');
  console.log('═'.repeat(60));

  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto('https://teams.microsoft.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(`  Nav warning: ${e.message.substring(0, 60)}`);
  }

  await page.waitForTimeout(3000);
  const authed = await handleAuth(page);

  if (!authed) {
    console.log('  ❌ Teams auth failed');
    return { success: false, chars: 0 };
  }

  // Wait for Teams to fully load (it's a heavy SPA)
  console.log('  ⏳ Waiting for Teams to load...');
  await page.waitForTimeout(15000);

  // Take screenshot
  await page.screenshot({ path: path.join(OUT_DIR, 'teams.png'), fullPage: false });
  console.log('  📸 teams.png saved');

  // Try to navigate to Teams list
  try {
    const teamsBtn = await page.$('button[aria-label*="Teams"], a[aria-label*="Teams"], [data-tid="teams-app-bar-teams"]');
    if (teamsBtn) {
      console.log('  → Clicking Teams sidebar...');
      await teamsBtn.click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: path.join(OUT_DIR, 'teams-list.png'), fullPage: false });
    }
  } catch (e) { /* ignore */ }

  // Extract all visible text
  const teamsText = await page.evaluate(() => {
    const texts = [];
    texts.push(`Title: ${document.title}`);
    texts.push(`URL: ${window.location.href}`);
    texts.push('');

    // Try to find team names
    const teams = document.querySelectorAll('[data-tid*="team-"], [class*="team-name"], [role="treeitem"]');
    if (teams.length > 0) {
      texts.push(`=== TEAMS (${teams.length} found) ===`);
      teams.forEach((t, i) => {
        const text = t.innerText?.trim();
        if (text && text.length > 2) texts.push(`${i + 1}. ${text}`);
      });
    }

    // Get channels
    const channels = document.querySelectorAll('[data-tid*="channel-"], [class*="channel-name"]');
    if (channels.length > 0) {
      texts.push(`\n=== CHANNELS (${channels.length} found) ===`);
      channels.forEach((c, i) => {
        const text = c.innerText?.trim();
        if (text && text.length > 2) texts.push(`${i + 1}. ${text}`);
      });
    }

    // Get chat list
    const chats = document.querySelectorAll('[data-tid*="chat-"], [class*="chatListItem"]');
    if (chats.length > 0) {
      texts.push(`\n=== RECENT CHATS (${chats.length} found) ===`);
      chats.forEach((c, i) => {
        const text = c.innerText?.trim().replace(/\n/g, ' | ');
        if (text && text.length > 2) texts.push(`${i + 1}. ${text}`);
      });
    }

    // Full page text fallback
    const allText = document.body?.innerText || '';
    if (allText.length > 100) {
      texts.push('\n=== FULL PAGE TEXT ===');
      texts.push(allText);
    }

    return texts.join('\n');
  });

  fs.writeFileSync(path.join(OUT_DIR, 'teams.txt'), teamsText, 'utf-8');
  console.log(`  📝 teams.txt: ${teamsText.length} chars`);

  return { success: true, chars: teamsText.length };
}

(async () => {
  const cmd = process.argv[2] || 'all';

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('🚀 Teams & Calendar Scraper (Playwright + Okta SSO)');
  console.log(`Command: ${cmd}`);
  console.log(`Session: ${SESSION_DIR}\n`);

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const results = {};

  try {
    if (cmd === 'calendar' || cmd === 'all') {
      results.calendar = await scrapeCalendar(context);
    }

    if (cmd === 'teams' || cmd === 'all') {
      results.teams = await scrapeTeams(context);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('RESULTS');
    console.log('═'.repeat(60));
    for (const [key, val] of Object.entries(results)) {
      const icon = val.success ? '✅' : '❌';
      console.log(`${icon} ${key}: ${val.chars} chars`);
    }

    fs.writeFileSync(path.join(OUT_DIR, '_results.json'), JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }

  console.log('\nClosing in 5s...');
  await new Promise(r => setTimeout(r, 5000));
  await context.close();
})();
