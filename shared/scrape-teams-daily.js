/**
 * Teams Daily Capture — Incremental conversation & transcript extraction
 * 
 * Captures Teams channel messages, chat threads, and meeting transcripts
 * using Playwright + Okta SSO. Designed for daily runs with incremental tracking.
 * 
 * Usage:
 *   node shared/scrape-teams-daily.js --client <name>                    # all targets
 *   node shared/scrape-teams-daily.js --client <name> --target channels  # channels only
 *   node shared/scrape-teams-daily.js --client <name> --target chats     # chats only
 *   node shared/scrape-teams-daily.js --client <name> --target transcripts
 *   node shared/scrape-teams-daily.js --client <name> --target calendar
 * 
 * Skill: ~/.claude/skills/teams-capture/SKILL.md
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');  // optional — graceful fallback if not installed

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ROOT_DIR = path.join(__dirname, '..');
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const CLIENT = getArg('client') || 'oncohealth';
const TARGET = getArg('target') || 'all';
const TODAY = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

const CLIENT_DIR = path.join(ROOT_DIR, 'clients', CLIENT);
const OUT_DIR = path.join(CLIENT_DIR, 'output', 'teams-daily');
const TODAY_DIR = path.join(OUT_DIR, TODAY);
const SESSION_DIR = path.join(ROOT_DIR, '.playwright-session-okta');
const INDEX_PATH = path.join(OUT_DIR, 'index.json');

// Ensure directories exist
[OUT_DIR, TODAY_DIR,
 path.join(TODAY_DIR, 'channels'),
 path.join(TODAY_DIR, 'chats'),
 path.join(TODAY_DIR, 'transcripts'),
].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ---------------------------------------------------------------------------
// Load .env (client-level first, then shared)
// ---------------------------------------------------------------------------
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim();
    }
  }
}
loadEnv(path.join(CLIENT_DIR, '.env'));
loadEnv(path.join(ROOT_DIR, '.env'));
loadEnv(path.join(__dirname, '.env'));

const MS_EMAIL = process.env.MS_USERNAME;
const MS_PASS = process.env.MS_PASSWORD;
const OKTA_USER = MS_EMAIL ? MS_EMAIL.split('@')[0] : 'ccarrillo';

// ---------------------------------------------------------------------------
// Load client.yaml for teams_capture config (optional)
// ---------------------------------------------------------------------------
let clientConfig = {};
try {
  const yamlPath = path.join(CLIENT_DIR, 'client.yaml');
  if (fs.existsSync(yamlPath)) {
    const content = fs.readFileSync(yamlPath, 'utf-8');
    // Try js-yaml first, fall back to basic parsing
    try {
      clientConfig = yaml.load(content);
    } catch (e) {
      // Basic YAML-like parsing for teams_capture section
      const match = content.match(/teams_capture:[\s\S]*?(?=\n\S|\n$|$)/);
      if (match) {
        console.log('  ℹ️  js-yaml not available, using basic config parsing');
      }
    }
  }
} catch (e) { /* ignore */ }

const teamsConfig = clientConfig.teams_capture || {
  team_name: 'OncoHealth_NewFire',
  channels: ['General', 'NewUM', 'Clinical Scheduling', 'CRS/CRR Scheduling', 'IT Helpdesk Scheduling'],
  priority_chats: [
    'Data team - daily',
    'Eligibility - Person/Member workshop',
    'Payer taxonomy workshop',
    'Databricks Lakeflow Connect',
    'Provider Discussion',
    'Claude workshop',
    'Erik and Michal',
    'Eligibility workshop',
  ],
  scroll_depth: 3,
  capture_transcripts: true,
};

// ---------------------------------------------------------------------------
// Load capture index
// ---------------------------------------------------------------------------
let captureIndex = { last_capture: null, captures: [] };
if (fs.existsSync(INDEX_PATH)) {
  try { captureIndex = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8')); } catch (e) { /* fresh */ }
}

// ---------------------------------------------------------------------------
// Auth handler (reused from scrape-teams-calendar.js)
// ---------------------------------------------------------------------------
async function handleAuth(page, maxRounds = 20) {
  for (let round = 0; round < maxRounds; round++) {
    await page.waitForTimeout(2000);
    const url = page.url();
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');

    console.log(`  [Auth ${round}] ${url.substring(0, 80)}...`);

    // Microsoft: enter email
    if (url.includes('login.microsoftonline.com')) {
      // "Pick an account" page
      try {
        const tile = await page.$(`div[data-test-id="${MS_EMAIL}"], small:has-text("${MS_EMAIL}")`);
        if (tile) {
          console.log(`  → Picking account: ${MS_EMAIL}`);
          await tile.click();
          await page.waitForTimeout(4000);
          continue;
        }
      } catch (e) { /* ignore */ }

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

      // Password
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

      // MFA
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
            console.log('  ✅ MFA approved!');
            await page.waitForTimeout(3000);
            return true;
          }
          console.log(`  [${(i + 1) * 5}s] Waiting for MFA...`);
        }
        console.log('  ❌ MFA timeout');
        return false;
      }
    }

    // Check if loaded
    const noAuth = !url.includes('login') && !url.includes('okta') && !url.includes('sso.') && body.length > 200;
    if (noAuth) {
      console.log('  ✅ Authenticated!');
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helper: sanitize filename
// ---------------------------------------------------------------------------
function sanitize(name) {
  return name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').substring(0, 80);
}

// ---------------------------------------------------------------------------
// Helper: extract structured messages from current Teams view
// ---------------------------------------------------------------------------
async function extractMessages(page) {
  return await page.evaluate(() => {
    const messages = [];

    // Try structured extraction first (Teams DOM selectors)
    const msgElements = document.querySelectorAll(
      '[data-tid="messageBodyContent"], ' +
      '[class*="message-body"], ' +
      'div[role="document"][class*="message"]'
    );

    if (msgElements.length > 0) {
      msgElements.forEach((el, i) => {
        // Try to find sender and timestamp in parent/sibling elements
        const container = el.closest('[data-tid="chatMessageContainer"], [class*="message-container"], [role="listitem"]') || el.parentElement;
        const timeEl = container?.querySelector('time, [data-tid="messageTimeStamp"], [class*="timestamp"]');
        const senderEl = container?.querySelector('[data-tid="messageHeaderName"], [class*="sender"], [class*="author"]');

        const text = el.innerText?.trim();
        if (text && text.length > 1) {
          messages.push({
            sender: senderEl?.innerText?.trim() || '(unknown)',
            time: timeEl?.getAttribute('datetime') || timeEl?.innerText?.trim() || '',
            text: text,
          });
        }
      });
    }

    // If structured extraction found messages, return them
    if (messages.length > 0) {
      return { structured: true, messages, fullText: '' };
    }

    // Fallback: full page text
    return {
      structured: false,
      messages: [],
      fullText: document.body?.innerText || '',
    };
  });
}

// ---------------------------------------------------------------------------
// Format messages to text
// ---------------------------------------------------------------------------
function formatMessages(result, title) {
  const lines = [];
  lines.push(`=== ${title} ===`);
  lines.push(`Captured: ${new Date().toISOString()}`);
  lines.push('');

  if (result.structured && result.messages.length > 0) {
    lines.push(`[${result.messages.length} messages extracted (structured)]`);
    lines.push('');
    for (const msg of result.messages) {
      const time = msg.time ? `[${msg.time}]` : '';
      lines.push(`${time} ${msg.sender}: ${msg.text}`);
      lines.push('');
    }
  } else if (result.fullText) {
    lines.push('[Full page text extraction (fallback)]');
    lines.push('');
    lines.push(result.fullText);
  } else {
    lines.push('[No content captured]');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Capture: Channels
// ---------------------------------------------------------------------------
async function captureChannels(page) {
  console.log('\n' + '═'.repeat(60));
  console.log('📢 CHANNELS');
  console.log('═'.repeat(60));

  const results = {};
  const channelNames = teamsConfig.channels || [];

  // Navigate to Teams
  try {
    await page.goto('https://teams.microsoft.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(`  Nav warning: ${e.message.substring(0, 60)}`);
  }
  await page.waitForTimeout(5000);

  const authed = await handleAuth(page);
  if (!authed) {
    console.log('  ❌ Auth failed');
    return results;
  }

  // Wait for Teams SPA to load (it's heavy — 20s)
  console.log('  ⏳ Waiting for Teams to load (20s)...');
  await page.waitForTimeout(20000);

  // Screenshot: initial state
  await page.screenshot({ path: path.join(TODAY_DIR, 'teams-overview.png'), fullPage: false });

  // Channels are in the sidebar tree as [role="treeitem"]
  // Under "Teams and channels" section
  for (const channelName of channelNames) {
    console.log(`\n  📌 Channel: ${channelName}`);
    try {
      // Find channel in sidebar treeitem list
      const channelItem = await page.$(`[role="treeitem"]:has-text("${channelName}")`);
      if (channelItem) {
        // Check this is a leaf item (actual channel, not the parent "Teams and channels" section)
        const itemLabel = await channelItem.innerText();
        // Skip the parent container that lists all channels
        if (itemLabel.includes('Teams and channels') && itemLabel.length > channelName.length + 30) {
          // This is the parent — find the specific child
          const specific = await page.$(`[role="treeitem"] >> text="${channelName}"`);
          if (specific) {
            await specific.click();
          } else {
            console.log(`    ⚠️  Could not isolate channel "${channelName}" from parent`);
            results[channelName] = { chars: 0, error: 'parent container matched, not leaf' };
            continue;
          }
        } else {
          await channelItem.click();
        }
        await page.waitForTimeout(5000);

        // Scroll up to load older messages
        const scrollDepth = teamsConfig.scroll_depth || 3;
        for (let s = 0; s < scrollDepth; s++) {
          await page.evaluate(() => {
            const containers = document.querySelectorAll('[role="main"], [class*="message-list"], [data-tid="messageListContainer"]');
            containers.forEach(c => c.scrollTop = 0);
            // Also try scrolling the first scrollable element
            const scrollable = document.querySelector('[class*="scroll"]');
            if (scrollable) scrollable.scrollTop = 0;
          });
          await page.waitForTimeout(2000);
          if (s % 5 === 0 && s > 0) console.log(`    ↑ Scrolled ${s}/${scrollDepth} pages...`);
        }
        await page.waitForTimeout(3000);

        // Extract messages
        const msgResult = await extractMessages(page);
        const text = formatMessages(msgResult, `Channel: ${channelName}`);
        const filename = sanitize(channelName) + '.txt';
        const filePath = path.join(TODAY_DIR, 'channels', filename);
        fs.writeFileSync(filePath, text, 'utf-8');

        const charCount = text.length;
        const msgCount = msgResult.structured ? msgResult.messages.length : '(fallback)';
        console.log(`    ✅ ${charCount} chars, ${msgCount} messages → ${filename}`);
        results[channelName] = { chars: charCount, messages: msgCount, file: filename };
      } else {
        console.log(`    ⚠️  Channel "${channelName}" not found in sidebar`);
        results[channelName] = { chars: 0, error: 'not found in sidebar' };
      }
    } catch (e) {
      console.log(`    ❌ Error: ${e.message.substring(0, 60)}`);
      results[channelName] = { chars: 0, error: e.message.substring(0, 100) };
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Capture: Chats
// ---------------------------------------------------------------------------
async function captureChats(page) {
  console.log('\n' + '═'.repeat(60));
  console.log('💬 CHATS');
  console.log('═'.repeat(60));

  const results = {};
  const priorityChats = teamsConfig.priority_chats || [];

  // Navigate to Chat via sidebar button (data-tid from DOM inspector)
  try {
    const chatBtn = await page.$('button[aria-label*="Chat" i]');
    if (chatBtn) {
      console.log('  → Clicking Chat sidebar');
      await chatBtn.click();
      await page.waitForTimeout(5000);
    }
  } catch (e) {
    console.log(`  Nav warning: ${e.message.substring(0, 60)}`);
  }

  // Screenshot: Chat list
  await page.screenshot({ path: path.join(TODAY_DIR, 'chats-overview.png'), fullPage: false });

  // Capture all visible chat entries from the sidebar tree
  const chatList = await page.evaluate(() => {
    // In new Teams, chats are [role="treeitem"] under "Chats" section
    const items = document.querySelectorAll('[role="treeitem"]');
    return Array.from(items)
      .map(item => ({
        text: item.innerText?.trim().replace(/\n/g, ' | ').substring(0, 200),
      }))
      .filter(c => c.text && c.text.length > 3 &&
        !c.text.startsWith('Copilot') &&
        !c.text.startsWith('Discover') &&
        !c.text.startsWith('Mentions') &&
        !c.text.startsWith('Followed') &&
        !c.text.startsWith('Favorites') &&
        !c.text.startsWith('Teams and channels') &&
        !c.text.startsWith('See all') &&
        !c.text.startsWith('Chats |'));    // skip the "Chats" parent node
  });
  console.log(`  Found ${chatList.length} items in sidebar`);

  // For priority chats, click in sidebar treeitem and capture
  for (const chatName of priorityChats) {
    console.log(`\n  💬 Chat: ${chatName}`);
    try {
      // Find the chat in sidebar treeitem list
      const chatItem = await page.$(`[role="treeitem"]:has-text("${chatName}")`);
      if (chatItem) {
        // Verify it's the leaf item, not a parent container
        const itemText = await chatItem.innerText();
        if (itemText.includes('Chats |') || itemText.length > chatName.length + 50) {
          // Parent container — try more specific
          const specific = await page.$(`[role="treeitem"] >> text="${chatName}"`);
          if (specific) {
            await specific.click();
          } else {
            console.log(`    ⚠️  Could not isolate chat "${chatName}" from parent`);
            results[chatName] = { chars: 0, error: 'parent matched' };
            continue;
          }
        } else {
          await chatItem.click();
        }
        await page.waitForTimeout(5000);

        // Scroll up for older messages
        const scrollDepth = teamsConfig.scroll_depth || 3;
        for (let s = 0; s < scrollDepth; s++) {
          await page.evaluate(() => {
            const containers = document.querySelectorAll('[role="main"], [class*="message-list"], [data-tid="messageListContainer"]');
            containers.forEach(c => c.scrollTop = 0);
            const scrollable = document.querySelector('[class*="scroll"]');
            if (scrollable) scrollable.scrollTop = 0;
          });
          await page.waitForTimeout(2000);
          if (s % 5 === 0 && s > 0) console.log(`    ↑ Scrolled ${s}/${scrollDepth} pages...`);
        }
        await page.waitForTimeout(2000);

        // Extract messages — try structured first, then fallback to pane items
        const msgResult = await page.evaluate(() => {
          const messages = [];

          // Strategy 1: chat-pane-message items (found in DOM inspector)
          const paneMessages = document.querySelectorAll('[data-tid="chat-pane-message"]');
          if (paneMessages.length > 0) {
            paneMessages.forEach(el => {
              const text = el.innerText?.trim();
              if (text && text.length > 1 && text !== 'has context menu') {
                messages.push({ sender: '', time: '', text });
              }
            });
          }

          // Strategy 2: messageBodyContent (standard Teams selector)
          if (messages.length === 0) {
            const bodyMsgs = document.querySelectorAll('[data-tid="messageBodyContent"]');
            bodyMsgs.forEach(el => {
              const container = el.closest('[role="listitem"]') || el.parentElement;
              const timeEl = container?.querySelector('time');
              const senderEl = container?.querySelector('[data-tid="messageHeaderName"]');
              const text = el.innerText?.trim();
              if (text && text.length > 1) {
                messages.push({
                  sender: senderEl?.innerText?.trim() || '',
                  time: timeEl?.getAttribute('datetime') || timeEl?.innerText?.trim() || '',
                  text,
                });
              }
            });
          }

          if (messages.length > 0) {
            return { structured: true, messages, fullText: '' };
          }

          // Fallback: full page text
          const mainArea = document.querySelector('[role="main"]');
          return {
            structured: false,
            messages: [],
            fullText: mainArea?.innerText || document.body?.innerText || '',
          };
        });

        const text = formatMessages(msgResult, `Chat: ${chatName}`);
        const filename = sanitize(chatName) + '.txt';
        const filePath = path.join(TODAY_DIR, 'chats', filename);
        fs.writeFileSync(filePath, text, 'utf-8');

        const charCount = text.length;
        const msgCount = msgResult.structured ? msgResult.messages.length : '(fallback)';
        console.log(`    ✅ ${charCount} chars, ${msgCount} messages → ${filename}`);
        results[chatName] = { chars: charCount, messages: msgCount, file: filename };
      } else {
        console.log(`    ⚠️  Chat "${chatName}" not found in sidebar`);
        results[chatName] = { chars: 0, error: 'not found in sidebar' };
      }
    } catch (e) {
      console.log(`    ❌ Error: ${e.message.substring(0, 60)}`);
      results[chatName] = { chars: 0, error: e.message.substring(0, 100) };
    }
  }

  // Save chat list summary
  if (chatList.length > 0) {
    const listText = ['=== CHAT LIST SUMMARY ===',
      `Captured: ${new Date().toISOString()}`, '',
      ...chatList.map((c, i) => `${i + 1}. ${c.text}`),
    ].join('\n');
    fs.writeFileSync(path.join(TODAY_DIR, 'chats', '_chat-list.txt'), listText, 'utf-8');
    console.log(`\n  📋 Chat list summary: ${chatList.length} chats`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Capture: Calendar (today's events)
// ---------------------------------------------------------------------------
async function captureCalendar(page) {
  console.log('\n' + '═'.repeat(60));
  console.log('📅 CALENDAR');
  console.log('═'.repeat(60));

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

  console.log('  ⏳ Loading calendar (10s)...');
  await page.waitForTimeout(10000);

  await page.screenshot({ path: path.join(TODAY_DIR, 'calendar.png'), fullPage: false });

  const calText = await page.evaluate(() => {
    const texts = [];
    texts.push(`Title: ${document.title}`);
    texts.push(`URL: ${window.location.href}`);
    texts.push('');
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
    const allText = document.body?.innerText || '';
    if (allText.length > 100) {
      texts.push('\n=== FULL PAGE TEXT ===');
      texts.push(allText);
    }
    return texts.join('\n');
  });

  const filePath = path.join(TODAY_DIR, 'calendar.txt');
  fs.writeFileSync(filePath, calText, 'utf-8');
  console.log(`  ✅ calendar.txt: ${calText.length} chars`);

  return { success: true, chars: calText.length };
}

// ---------------------------------------------------------------------------
// Capture: Transcripts (from meeting chats)
// ---------------------------------------------------------------------------
async function captureTranscripts(page) {
  console.log('\n' + '═'.repeat(60));
  console.log('📝 TRANSCRIPTS');
  console.log('═'.repeat(60));

  // Transcripts appear in Teams meeting chats or Calendar meeting details
  // Strategy: check Chat tab for meetings with transcript indicators

  const results = {};

  // Navigate to calendar view in Teams to find recent meetings
  try {
    const calBtn = await page.$('button[aria-label*="Calendar"], a[aria-label*="Calendar"], [data-tid="teams-app-bar-calendar"]');
    if (calBtn) {
      console.log('  → Clicking Calendar in Teams');
      await calBtn.click();
      await page.waitForTimeout(8000);
    }
  } catch (e) { /* ignore */ }

  await page.screenshot({ path: path.join(TODAY_DIR, 'transcripts-calendar.png'), fullPage: false });

  // Look for meetings with "Recap" or "Transcript" indicators
  const meetings = await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="calendar-event"], [role="listitem"], [data-app-section="CalendarEvent"]');
    return Array.from(items).map(item => ({
      text: item.innerText?.trim().substring(0, 200),
      hasTranscript: item.innerText?.toLowerCase().includes('transcript') ||
                     item.innerText?.toLowerCase().includes('recap') ||
                     item.innerText?.toLowerCase().includes('recording'),
    })).filter(m => m.text && m.text.length > 3);
  });

  console.log(`  Found ${meetings.length} calendar items`);
  const withTranscripts = meetings.filter(m => m.hasTranscript);
  if (withTranscripts.length > 0) {
    console.log(`  📎 ${withTranscripts.length} with transcript/recap indicators`);
  }

  // For each meeting with transcript, try to click and extract
  for (const meeting of withTranscripts) {
    const shortName = meeting.text.split('\n')[0].substring(0, 60);
    console.log(`\n  📝 Meeting: ${shortName}`);
    try {
      // Click on the meeting
      const meetingEl = await page.$(`[role="listitem"]:has-text("${shortName}"), [class*="calendar-event"]:has-text("${shortName}")`);
      if (meetingEl) {
        await meetingEl.click();
        await page.waitForTimeout(5000);

        // Look for transcript tab/button
        const transcriptBtn = await page.$('button:has-text("Transcript"), a:has-text("Transcript"), [aria-label*="Transcript"]');
        if (transcriptBtn) {
          await transcriptBtn.click();
          await page.waitForTimeout(5000);
        }

        // Look for recap tab/button
        const recapBtn = await page.$('button:has-text("Recap"), a:has-text("Recap"), [aria-label*="Recap"]');
        if (recapBtn) {
          await recapBtn.click();
          await page.waitForTimeout(5000);
        }

        // Extract whatever is visible
        const content = await page.evaluate(() => document.body?.innerText || '');
        const filename = sanitize(shortName) + '.txt';
        const filePath = path.join(TODAY_DIR, 'transcripts', filename);
        fs.writeFileSync(filePath, `=== Transcript: ${shortName} ===\nCaptured: ${new Date().toISOString()}\n\n${content}`, 'utf-8');
        console.log(`    ✅ ${content.length} chars → ${filename}`);
        results[shortName] = { chars: content.length, file: filename };

        // Go back
        await page.goBack();
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      console.log(`    ❌ Error: ${e.message.substring(0, 60)}`);
    }
  }

  if (Object.keys(results).length === 0) {
    console.log('  ℹ️  No transcripts found for today');

    // Save a summary of what meetings exist
    if (meetings.length > 0) {
      const summary = ['=== MEETINGS (no transcripts) ===',
        `Date: ${TODAY}`, '',
        ...meetings.map((m, i) => `${i + 1}. ${m.text.split('\n')[0]}`),
      ].join('\n');
      fs.writeFileSync(path.join(TODAY_DIR, 'transcripts', '_meetings-summary.txt'), summary, 'utf-8');
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log('🚀 Teams Daily Capture');
  console.log(`Client: ${CLIENT}`);
  console.log(`Target: ${TARGET}`);
  console.log(`Date: ${TODAY}`);
  console.log(`Output: ${TODAY_DIR}`);
  console.log(`Session: ${SESSION_DIR}\n`);

  if (!MS_EMAIL || !MS_PASS) {
    console.error('❌ MS_USERNAME and MS_PASSWORD required in .env');
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const capture = {
    date: TODAY,
    started: new Date().toISOString(),
    channels: {},
    chats: {},
    calendar: {},
    transcripts: {},
    total_chars: 0,
  };

  try {
    const page = context.pages()[0] || await context.newPage();

    if (TARGET === 'channels' || TARGET === 'all') {
      capture.channels = await captureChannels(page);
    }

    if (TARGET === 'chats' || TARGET === 'all') {
      capture.chats = await captureChats(page);
    }

    if (TARGET === 'calendar' || TARGET === 'all') {
      capture.calendar = await captureCalendar(page);
    }

    if (TARGET === 'transcripts' || TARGET === 'all') {
      if (teamsConfig.capture_transcripts !== false) {
        capture.transcripts = await captureTranscripts(page);
      }
    }

    // Calculate totals
    const countChars = (obj) => Object.values(obj).reduce((sum, v) => sum + (v.chars || 0), 0);
    capture.total_chars = countChars(capture.channels) + countChars(capture.chats) +
                          (capture.calendar.chars || 0) + countChars(capture.transcripts);

    capture.completed = new Date().toISOString();

    // Update index
    captureIndex.last_capture = capture.completed;
    captureIndex.captures.push({
      date: TODAY,
      channels: Object.keys(capture.channels).length,
      chats: Object.keys(capture.chats).length,
      transcripts: Object.keys(capture.transcripts).length,
      calendar_chars: capture.calendar.chars || 0,
      total_chars: capture.total_chars,
    });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(captureIndex, null, 2), 'utf-8');

    // Save daily summary
    fs.writeFileSync(path.join(TODAY_DIR, '_summary.json'), JSON.stringify(capture, null, 2), 'utf-8');

    // Print summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 DAILY CAPTURE SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Date:         ${TODAY}`);
    console.log(`Channels:     ${Object.keys(capture.channels).length} captured`);
    console.log(`Chats:        ${Object.keys(capture.chats).length} captured`);
    console.log(`Calendar:     ${capture.calendar.chars || 0} chars`);
    console.log(`Transcripts:  ${Object.keys(capture.transcripts).length} captured`);
    console.log(`Total chars:  ${capture.total_chars.toLocaleString()}`);
    console.log(`Output:       ${TODAY_DIR}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }

  console.log('\nClosing in 5s...');
  await new Promise(r => setTimeout(r, 5000));
  await context.close();
})();
