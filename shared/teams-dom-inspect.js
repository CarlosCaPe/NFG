/**
 * Teams DOM Inspector — Diagnostic tool to discover current Teams Web DOM structure
 * 
 * Opens Teams, takes screenshots, and dumps DOM selectors for:
 * - Sidebar navigation (Teams, Chat, Calendar buttons)
 * - Team/channel list
 * - Chat list items
 * - Message containers
 * 
 * Usage: node shared/teams-dom-inspect.js --client oncohealth
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const args = process.argv.slice(2);
const CLIENT = args.includes('--client') ? args[args.indexOf('--client') + 1] : 'oncohealth';
const CLIENT_DIR = path.join(ROOT_DIR, 'clients', CLIENT);
const SESSION_DIR = path.join(ROOT_DIR, '.playwright-session-okta');
const OUT_DIR = path.join(CLIENT_DIR, 'output', 'teams-daily', '_debug');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Load .env
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}
loadEnv(path.join(CLIENT_DIR, '.env'));
loadEnv(path.join(ROOT_DIR, '.env'));
loadEnv(path.join(__dirname, '.env'));

const MS_EMAIL = process.env.MS_USERNAME;
const MS_PASS = process.env.MS_PASSWORD;

async function handleAuth(page, maxRounds = 15) {
  for (let round = 0; round < maxRounds; round++) {
    await page.waitForTimeout(2000);
    const url = page.url();
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');
    console.log(`  [Auth ${round}] ${url.substring(0, 80)}...`);

    if (url.includes('login.microsoftonline.com')) {
      try {
        const tile = await page.$(`div[data-test-id="${MS_EMAIL}"], small:has-text("${MS_EMAIL}")`);
        if (tile) { await tile.click(); await page.waitForTimeout(4000); continue; }
      } catch (e) {}
      try {
        const emailField = await page.$('input[type="email"], input[name="loginfmt"]');
        if (emailField) {
          const val = await emailField.inputValue();
          if (!val) { await emailField.fill(MS_EMAIL); await page.waitForTimeout(500); await page.click('input[type="submit"]'); await page.waitForTimeout(4000); continue; }
        }
      } catch (e) {}
      try { const yesBtn = await page.$('input[value="Yes"]'); if (yesBtn) { await yesBtn.click(); await page.waitForTimeout(3000); continue; } } catch (e) {}
      try {
        const passField = await page.$('input[type="password"][name="passwd"]');
        if (passField) { await passField.fill(MS_PASS); await page.waitForTimeout(500); await page.click('input[type="submit"]'); await page.waitForTimeout(4000); continue; }
      } catch (e) {}
    }

    if (url.includes('sso.oncologyanalytics.com') || url.includes('okta.com')) {
      try {
        const userField = await page.$('#okta-signin-username, input[name="username"], input[name="identifier"]');
        if (userField) { const val = await userField.inputValue(); if (!val) { await userField.fill(MS_EMAIL.split('@')[0]); await page.waitForTimeout(500); } }
      } catch (e) {}
      try {
        const passField = await page.$('#okta-signin-password, input[name="password"], input[type="password"]');
        if (passField) { const val = await passField.inputValue(); if (!val) { await passField.fill(MS_PASS); await page.waitForTimeout(500); } }
      } catch (e) {}
      try {
        const submitBtn = await page.$('#okta-signin-submit, input[type="submit"], button[type="submit"]');
        if (submitBtn) { await submitBtn.click(); await page.waitForTimeout(5000); continue; }
      } catch (e) {}
      if (body.includes('Okta Verify') || body.includes('Send push') || body.includes('Push notification')) {
        try { const pushBtn = await page.$('input[value="Send Push"], button:has-text("Send Push"), a:has-text("Send Push")'); if (pushBtn) await pushBtn.click(); } catch (e) {}
        console.log('  📱 MFA: Approve Okta Verify push!');
        for (let i = 0; i < 12; i++) {
          await page.waitForTimeout(5000);
          if (!page.url().includes('okta.com') && !page.url().includes('sso.oncologyanalytics.com')) { console.log('  ✅ MFA approved!'); await page.waitForTimeout(3000); return true; }
          console.log(`  [${(i+1)*5}s] Waiting...`);
        }
        return false;
      }
    }

    if (!url.includes('login') && !url.includes('okta') && !url.includes('sso.') && body.length > 200) {
      console.log('  ✅ Authenticated!');
      return true;
    }
  }
  return false;
}

(async () => {
  console.log('🔍 Teams DOM Inspector');
  console.log(`Session: ${SESSION_DIR}\n`);
  
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();
  
  try {
    // 1. Navigate to Teams
    console.log('\n=== STEP 1: Navigate to Teams ===');
    await page.goto('https://teams.microsoft.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const authed = await handleAuth(page);
    if (!authed) { console.log('❌ Auth failed'); await context.close(); return; }
    
    console.log('⏳ Waiting 20s for Teams SPA to load...');
    await page.waitForTimeout(20000);
    
    await page.screenshot({ path: path.join(OUT_DIR, '01-teams-initial.png'), fullPage: false });
    console.log('📸 01-teams-initial.png');

    // 2. Inspect sidebar buttons
    console.log('\n=== STEP 2: Sidebar Navigation ===');
    const sidebarInfo = await page.evaluate(() => {
      const results = [];
      
      // Find all buttons and links in the left rail
      const navItems = document.querySelectorAll('nav button, nav a, [role="navigation"] button, [role="navigation"] a, [class*="app-bar"] button, [class*="rail"] button');
      results.push(`Nav items found: ${navItems.length}`);
      navItems.forEach((el, i) => {
        const label = el.getAttribute('aria-label') || el.innerText?.trim() || '';
        const tid = el.getAttribute('data-tid') || '';
        const tag = el.tagName;
        const id = el.id || '';
        if (label || tid) {
          results.push(`  [${i}] <${tag}> label="${label}" data-tid="${tid}" id="${id}"`);
        }
      });

      // Also check for any buttons with common Teams nav text
      const allBtns = document.querySelectorAll('button, a[role="tab"]');
      const teamsButtons = [];
      allBtns.forEach(btn => {
        const text = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
        if (text.includes('team') || text.includes('chat') || text.includes('calendar') || text.includes('activity') || text.includes('calls')) {
          teamsButtons.push({
            tag: btn.tagName,
            text: text.substring(0, 80),
            tid: btn.getAttribute('data-tid') || '',
            id: btn.id || '',
            class: btn.className?.substring(0, 80) || '',
          });
        }
      });
      results.push(`\nTeams-related buttons: ${teamsButtons.length}`);
      teamsButtons.forEach((b, i) => results.push(`  [${i}] <${b.tag}> text="${b.text}" tid="${b.tid}" class="${b.class}"`));

      return results.join('\n');
    });
    console.log(sidebarInfo);
    fs.writeFileSync(path.join(OUT_DIR, '02-sidebar.txt'), sidebarInfo, 'utf-8');

    // 3. Try to find and click Teams/Chat
    console.log('\n=== STEP 3: Click Teams or Chat ===');
    
    // Try multiple strategies to find Teams button
    const strategies = [
      'button[aria-label*="Team" i]',
      'a[aria-label*="Team" i]',
      '[data-tid*="team"]',
      'button:has-text("Teams")',
      'nav button:nth-child(3)',  // Often Teams is 3rd item
    ];
    
    let clicked = false;
    for (const sel of strategies) {
      try {
        const el = await page.$(sel);
        if (el) {
          const label = await el.getAttribute('aria-label') || await el.innerText();
          console.log(`  Found via "${sel}": ${label}`);
          await el.click();
          await page.waitForTimeout(5000);
          await page.screenshot({ path: path.join(OUT_DIR, '03-after-teams-click.png'), fullPage: false });
          clicked = true;
          break;
        }
      } catch (e) {}
    }
    if (!clicked) console.log('  ⚠️ Could not find Teams button');

    // 4. Inspect team/channel list
    console.log('\n=== STEP 4: Team/Channel List ===');
    const channelInfo = await page.evaluate(() => {
      const results = [];
      
      // Look for tree items, list items, and anything channel-like
      const selectors = [
        '[role="treeitem"]',
        '[role="listitem"]',
        '[data-tid*="channel"]',
        '[data-tid*="team"]',
        '[class*="channel"]',
        '[class*="team-name"]',
      ];
      
      for (const sel of selectors) {
        const items = document.querySelectorAll(sel);
        if (items.length > 0) {
          results.push(`\n${sel}: ${items.length} items`);
          items.forEach((el, i) => {
            if (i < 20) {  // limit output
              const text = el.innerText?.trim().replace(/\n/g, ' | ').substring(0, 120);
              const tid = el.getAttribute('data-tid') || '';
              results.push(`  [${i}] ${text} (tid="${tid}")`);
            }
          });
        }
      }
      
      // Also dump the full inner text of any sidebar/panel
      const sidebar = document.querySelector('[class*="team-panel"], [class*="channel-list"], [role="tree"]');
      if (sidebar) {
        results.push(`\nSidebar panel text:\n${sidebar.innerText?.substring(0, 2000)}`);
      }
      
      return results.join('\n');
    });
    console.log(channelInfo.substring(0, 3000));
    fs.writeFileSync(path.join(OUT_DIR, '04-channels.txt'), channelInfo, 'utf-8');

    // 5. Try to click Chat
    console.log('\n=== STEP 5: Click Chat ===');
    const chatStrategies = [
      'button[aria-label*="Chat" i]',
      'a[aria-label*="Chat" i]',
      '[data-tid*="chat"]',
      'button:has-text("Chat")',
    ];
    
    clicked = false;
    for (const sel of chatStrategies) {
      try {
        const el = await page.$(sel);
        if (el) {
          const label = await el.getAttribute('aria-label') || await el.innerText();
          console.log(`  Found via "${sel}": ${label}`);
          await el.click();
          await page.waitForTimeout(5000);
          await page.screenshot({ path: path.join(OUT_DIR, '05-after-chat-click.png'), fullPage: false });
          clicked = true;
          break;
        }
      } catch (e) {}
    }
    if (!clicked) console.log('  ⚠️ Could not find Chat button');

    // 6. Inspect chat list
    console.log('\n=== STEP 6: Chat List ===');
    const chatInfo = await page.evaluate(() => {
      const results = [];
      
      const selectors = [
        '[role="listitem"]',
        '[data-tid*="chat"]',
        '[class*="chatListItem"]',
        '[class*="listItem"]',
        '[role="option"]',
        '[role="row"]',
      ];
      
      for (const sel of selectors) {
        const items = document.querySelectorAll(sel);
        if (items.length > 0) {
          results.push(`\n${sel}: ${items.length} items`);
          items.forEach((el, i) => {
            if (i < 30) {
              const text = el.innerText?.trim().replace(/\n/g, ' | ').substring(0, 150);
              const tid = el.getAttribute('data-tid') || '';
              const ariaLabel = el.getAttribute('aria-label') || '';
              results.push(`  [${i}] text="${text}" tid="${tid}" aria="${ariaLabel.substring(0, 80)}"`);
            }
          });
        }
      }
      
      return results.join('\n');
    });
    console.log(chatInfo.substring(0, 3000));
    fs.writeFileSync(path.join(OUT_DIR, '06-chats.txt'), chatInfo, 'utf-8');

    // 7. Click first chat and inspect message structure
    console.log('\n=== STEP 7: Message Structure ===');
    try {
      const firstChat = await page.$('[role="listitem"], [role="option"], [role="row"]');
      if (firstChat) {
        await firstChat.click();
        await page.waitForTimeout(5000);
        await page.screenshot({ path: path.join(OUT_DIR, '07-chat-messages.png'), fullPage: false });
        
        const msgInfo = await page.evaluate(() => {
          const results = [];
          
          const selectors = [
            '[data-tid="messageBodyContent"]',
            '[data-tid*="message"]',
            '[class*="message-body"]',
            '[class*="MessageBody"]',
            '[role="document"]',
            '[class*="cke_contents"]',
          ];
          
          for (const sel of selectors) {
            const items = document.querySelectorAll(sel);
            if (items.length > 0) {
              results.push(`\n${sel}: ${items.length} items`);
              items.forEach((el, i) => {
                if (i < 10) {
                  const text = el.innerText?.trim().substring(0, 200);
                  results.push(`  [${i}] "${text}"`);
                }
              });
            }
          }

          // Also try to get the full text of the message area
          const mainArea = document.querySelector('[role="main"], [class*="chat-body"], [class*="message-list"]');
          if (mainArea) {
            results.push(`\nmain area text (first 2000 chars):\n${mainArea.innerText?.substring(0, 2000)}`);
          }
          
          return results.join('\n');
        });
        console.log(msgInfo.substring(0, 3000));
        fs.writeFileSync(path.join(OUT_DIR, '07-messages.txt'), msgInfo, 'utf-8');
      }
    } catch (e) {
      console.log(`  Error: ${e.message.substring(0, 60)}`);
    }

    // 8. Full page dump
    console.log('\n=== STEP 8: Full page text ===');
    const fullText = await page.evaluate(() => document.body?.innerText || '');
    fs.writeFileSync(path.join(OUT_DIR, '08-full-page.txt'), fullText, 'utf-8');
    console.log(`Full page text: ${fullText.length} chars`);

  } catch (err) {
    console.error('❌', err.message);
  }

  console.log('\n✅ Debug files saved to:', OUT_DIR);
  console.log('Closing in 5s...');
  await new Promise(r => setTimeout(r, 5000));
  await context.close();
})();
