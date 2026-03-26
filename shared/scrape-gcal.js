/**
 * Google Calendar Scraper — Capture events from NFG Google Calendar
 *
 * Uses storageState pattern (CrowdStrike-safe) to access calendar.google.com.
 * First run: opens browser for manual Google login → saves auth state.
 * Subsequent runs: reuses saved auth state (no login needed).
 *
 * Usage:
 *   node shared/scrape-gcal.js --client oncohealth                 (default: 14d back, 30d forward)
 *   node shared/scrape-gcal.js --client oncohealth --days 30       (both directions)
 *   node shared/scrape-gcal.js --client oncohealth --back 7 --forward 60
 *   node shared/scrape-gcal.js --client oncohealth --login         (force re-login)
 *
 * Output: clients/<client>/output/gcal/
 *   - gcal-events.json     — structured events
 *   - gcal-events.txt      — human-readable timeline
 *   - _capture-summary.json — metadata
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const clientArg = process.argv.indexOf('--client');
const CLIENT = clientArg !== -1 ? process.argv[clientArg + 1] : 'oncohealth';
const OUT_DIR = path.join(ROOT, 'clients', CLIENT, 'output', 'gcal');
const AUTH_STATE = path.join(ROOT, '.google-auth-state.json');
const FORCE_LOGIN = process.argv.includes('--login');

// Date range args
const daysArg = process.argv.indexOf('--days');
const backArg = process.argv.indexOf('--back');
const fwdArg = process.argv.indexOf('--forward');
const DAYS_BACK = backArg !== -1 ? parseInt(process.argv[backArg + 1]) : (daysArg !== -1 ? parseInt(process.argv[daysArg + 1]) : 14);
const DAYS_FWD = fwdArg !== -1 ? parseInt(process.argv[fwdArg + 1]) : (daysArg !== -1 ? parseInt(process.argv[daysArg + 1]) : 30);

function fmtDate(d) { return d.toISOString().split('T')[0]; }
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function waitForCalendarLoad(page, maxWaitMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(3000);
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');

    // Google login
    if (url.includes('accounts.google.com') || (bodyText.includes('Sign in') && bodyText.includes('Google'))) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  [${elapsed}s] Google login page — please sign in in the browser...`);
      continue;
    }

    // Calendar loaded — check for known calendar elements
    if (url.includes('calendar.google.com')) {
      const hasEvents = await page.evaluate(() => {
        return document.querySelector('[data-eventid]') !== null
          || document.querySelector('[data-eventchip]') !== null
          || document.querySelector('[role="main"]') !== null;
      });
      if (hasEvents || bodyText.length > 500) return true;
    }
  }
  return false;
}

/**
 * Extract events by navigating to the Schedule/Agenda view
 * and intercepting Google Calendar's internal API responses.
 * Falls back to DOM scraping if API interception yields nothing.
 */
async function extractEventsViaScheduleView(page, startDate, endDate) {
  console.log(`  Navigating to Schedule view: ${fmtDate(startDate)} → ${fmtDate(endDate)}`);

  // Set up network interception to capture internal calendar API responses
  const interceptedEvents = [];
  page.on('response', async (response) => {
    const url = response.url();
    // Target the actual event data endpoints (not JS bundles)
    const isEventEndpoint = url.includes('sync.fetcheventrange')
      || url.includes('sync.prefetcheventrange')
      || url.includes('minievents')
      || url.includes('sync.sync')
      || (url.includes('calendar/v3') && url.includes('events'));
    
    if (isEventEndpoint && response.status() === 200) {
      try {
        const text = await response.text();
        if (text.length > 50) {
          interceptedEvents.push({ url: url.substring(0, 300), size: text.length, body: text });
        }
      } catch {}
    }
  });

  // Navigate to Schedule/Agenda view via URL
  await page.goto(`https://calendar.google.com/calendar/u/0/r/agenda`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await page.waitForTimeout(8000);

  // Take diagnostic screenshot
  const screenshotPath = path.join(OUT_DIR, 'gcal-screenshot-agenda.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`  Screenshot saved: ${screenshotPath}`);

  // Check what view we're on
  const currentView = await page.evaluate(() => {
    const url = window.location.href;
    const title = document.title;
    const bodyLen = document.body?.innerText?.length || 0;
    
    // Check if "No events" or "No upcoming events" message is shown
    const noEvents = document.body?.innerText?.includes('No upcoming events')
      || document.body?.innerText?.includes('No events')
      || document.body?.innerText?.includes('Nothing planned');
    
    return { url, title, bodyLen, noEvents };
  });
  console.log(`  View: ${currentView.url}`);
  console.log(`  Title: ${currentView.title}, Body: ${currentView.bodyLen} chars`);
  if (currentView.noEvents) {
    console.log('  ⚠️  Calendar shows "No upcoming events" — calendar may be empty');
  }

  // Navigate to the specific start date using YYYY/MM/DD format
  const startYMD = `${startDate.getFullYear()}/${String(startDate.getMonth() + 1).padStart(2, '0')}/${String(startDate.getDate()).padStart(2, '0')}`;
  await page.goto(`https://calendar.google.com/calendar/u/0/r/agenda/${startYMD}`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await page.waitForTimeout(5000);

  // Scroll repeatedly to load events through the full date range
  // Google Calendar lazy-loads agenda items as you scroll
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(1200);
  }

  // Take second screenshot after scrolling
  const screenshotPath2 = path.join(OUT_DIR, 'gcal-screenshot-scrolled.png');
  await page.screenshot({ path: screenshotPath2, fullPage: true });

  // Extract ALL text and ALL aria-labels from the page
  const domData = await page.evaluate(() => {
    const results = [];

    // Get ALL aria-labels on the page for thorough extraction
    document.querySelectorAll('[aria-label]').forEach(el => {
      const label = el.getAttribute('aria-label') || '';
      const tag = el.tagName.toLowerCase();
      const eventId = el.getAttribute('data-eventid') || el.getAttribute('data-eventchip') || '';
      if (label.length > 10) {
        results.push({ ariaLabel: label, eventId, tag, method: 'aria' });
      }
    });

    // Get all elements with data-eventid or data-eventchip
    document.querySelectorAll('[data-eventid], [data-eventchip]').forEach(el => {
      const text = el.textContent?.trim() || '';
      const label = el.getAttribute('aria-label') || '';
      const id = el.getAttribute('data-eventid') || el.getAttribute('data-eventchip') || '';
      results.push({ text, ariaLabel: label, eventId: id, method: 'eventid' });
    });

    // Get full page text
    const fullText = document.body?.innerText || '';

    // Also capture HTML structure diagnostics
    const mainEl = document.querySelector('[role="main"]');
    const mainHtml = mainEl?.innerHTML?.substring(0, 5000) || '';

    return { items: results, fullText, mainHtml, url: window.location.href };
  });

  console.log(`  DOM: ${domData.items.length} labeled elements, ${domData.fullText.length} chars text`);
  console.log(`  API: ${interceptedEvents.length} intercepted responses (${interceptedEvents.reduce((s, e) => s + e.size, 0)} bytes)`);

  // Save full diagnostics
  const diagPath = path.join(OUT_DIR, 'gcal-diagnostics.json');
  fs.writeFileSync(diagPath, JSON.stringify({
    ariaLabels: domData.items.map(i => i.ariaLabel).filter(Boolean),
    fullTextPreview: domData.fullText.substring(0, 3000),
    mainHtmlPreview: domData.mainHtml,
    url: domData.url,
    interceptedCount: interceptedEvents.length,
    interceptedUrls: interceptedEvents.map(i => i.url),
  }, null, 2));
  console.log(`  Diagnostics: ${diagPath}`);

  return {
    chips: domData.items,
    fullText: domData.fullText,
    intercepted: interceptedEvents,
  };
}

/**
 * Parse aria-label text into structured event objects.
 * Google Calendar agenda aria-labels follow patterns like:
 *   "8am to 9am, Global Town Hall Q1_2026 , Carlos Carrillo, Accepted, No location, March 12, 2026"
 *   "All day, Benito Juárez's Birthday Memorial, Calendar: Holidays in Mexico, March 16, 2026"
 *   "Working location: Home, Carlos Carrillo, March 9 – 13, 2026"
 *   "1pm to 1:30pm, Meet, Carlos Carrillo, Accepted, Location: Microsoft Teams Meeting, March 23, 2026"
 */
function parseAriaLabel(label) {
  if (!label || label.length < 15) return null;

  // Pattern 1: "Working location: <place>, <person>, <dateRange>"
  const workLocMatch = label.match(/^Working location:\s*(.+?),\s*(.*?),\s*(.+)$/);
  if (workLocMatch) {
    return {
      title: `Working location: ${workLocMatch[1]}`,
      location: workLocMatch[1],
      date: workLocMatch[3].trim(),
      startTime: '(all day)',
      endTime: '',
      isAllDay: true,
      category: 'working-location',
      raw: label,
    };
  }

  // Pattern 2: "All day, <title>, Calendar: <cal>, [No location|Location: <loc>], <date>"
  const allDayMatch = label.match(/^All day,\s*(.+?)(?:,\s*Calendar:\s*(.+?))?(?:,\s*(?:No location|Location:\s*(.+?)))?,\s*(\w+ \d{1,2},?\s*\d{4})$/);
  if (allDayMatch) {
    return {
      title: allDayMatch[1].trim(),
      date: allDayMatch[4]?.trim() || '',
      startTime: '(all day)',
      endTime: '',
      isAllDay: true,
      location: allDayMatch[3] || '',
      calendar: allDayMatch[2] || '',
      raw: label,
    };
  }

  // Pattern 3: "<startTime> to <endTime>, <title>, <person>, <status>, [Location: <loc>|No location], <date>"
  const timedMatch = label.match(/^(\d{1,2}(?::\d{2})?(?:am|pm))\s+to\s+(\d{1,2}(?::\d{2})?(?:am|pm)),\s*(.+?)(?:,\s*Carlos Carrillo)?(?:,\s*(?:Accepted|Tentative|Declined|Maybe))?(?:,\s*(?:No location|Location:\s*(.+?)))?,\s*(\w+ \d{1,2},?\s*\d{4})$/i);
  if (timedMatch) {
    return {
      title: timedMatch[3].trim(),
      date: timedMatch[5]?.trim() || '',
      startTime: timedMatch[1],
      endTime: timedMatch[2],
      isAllDay: false,
      location: timedMatch[4] || '',
      raw: label,
    };
  }

  // Not a recognized event pattern
  return null;
}

/**
 * Parse the full-text schedule view into event blocks
 */
function parseScheduleText(fullText) {
  const lines = fullText.split('\n').filter(l => l.trim());
  const events = [];
  let currentDate = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Date header pattern
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s/i.test(trimmed)) {
      currentDate = trimmed;
      continue;
    }
    // Date header (just month day)
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s\d/i.test(trimmed)) {
      currentDate = trimmed;
      continue;
    }
    // Time pattern → this line is an event
    const timeMatch = trimmed.match(/^(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\s*(?:–|—|-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\s*(.*)/i);
    if (timeMatch) {
      events.push({
        date: currentDate,
        startTime: timeMatch[1],
        endTime: timeMatch[2],
        title: timeMatch[3].trim(),
      });
      continue;
    }
    // All-day event or event without time
    if (currentDate && trimmed.length > 3 && trimmed.length < 200 && !trimmed.match(/^(Search|Settings|Help|My calendars|Other calendars)/i)) {
      // Might be an event title on its own line
      if (events.length > 0 && !events[events.length - 1].title) {
        events[events.length - 1].title = trimmed;
      }
    }
  }

  return events;
}

async function main() {
  console.log(`\n📅 Google Calendar Scraper (NFG)`);
  console.log(`   Client:  ${CLIENT}`);
  console.log(`   Auth:    ${AUTH_STATE}`);

  const now = new Date();
  const startDate = new Date(now.getTime() - DAYS_BACK * 86400000);
  const endDate = new Date(now.getTime() + DAYS_FWD * 86400000);
  console.log(`   Range:   ${fmtDate(startDate)} → ${fmtDate(endDate)} (${DAYS_BACK}d back, ${DAYS_FWD}d forward)\n`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const hasAuth = fs.existsSync(AUTH_STATE) && !FORCE_LOGIN;

  // Strategy: try storageState first (CrowdStrike-safe), fall back to longer login
  const browser = await chromium.launch({
    headless: false,
    channel: 'msedge',
  });

  let context;
  if (hasAuth) {
    console.log('  Reusing saved Google auth state...');
    context = await browser.newContext({ storageState: AUTH_STATE, viewport: { width: 1400, height: 900 } });
  } else {
    console.log('  ⚠️  No saved auth state — browser will open for Google login');
    console.log('  → Please sign in to your NFG Google account in the browser window');
    console.log('  → Waiting up to 3 minutes for you to complete login...\n');
    context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  }

  const page = await context.newPage();

  try {
    // Navigate to Google Calendar
    console.log('  Opening calendar.google.com...');
    await page.goto('https://calendar.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const loaded = await waitForCalendarLoad(page);
    if (!loaded) {
      console.error('  ❌ Calendar did not load. Try: node shared/scrape-gcal.js --login');
      await browser.close();
      process.exit(1);
    }
    console.log('  ✅ Calendar loaded');

    // Save auth state for next time
    await context.storageState({ path: AUTH_STATE });
    console.log('  Auth state saved\n');

    // Capture the current user email for reference
    const userEmail = await page.evaluate(() => {
      const avatarBtn = document.querySelector('a[aria-label*="Google Account"]');
      return avatarBtn?.getAttribute('aria-label') || '';
    });
    if (userEmail) console.log(`  Account: ${userEmail}\n`);

    // Extract events from schedule/agenda view
    const raw = await extractEventsViaScheduleView(page, startDate, endDate);

    // Parse chip/aria events — parseAriaLabel returns null for non-event labels
    const chipEvents = (raw.chips || [])
      .map(c => parseAriaLabel(c.ariaLabel || c.text))
      .filter(Boolean);

    // Text parsing disabled — chip and API parsers produce higher quality data
    const textEvents = [];

    // Try to parse intercepted API data (sync endpoints)
    const apiEvents = [];
    if (raw.intercepted && raw.intercepted.length > 0) {
      // Save raw intercepted data for analysis
      const apiPath = path.join(OUT_DIR, 'gcal-api-raw.json');
      const apiSummary = raw.intercepted.map(i => ({
        url: i.url,
        size: i.size,
        bodyPreview: i.body.substring(0, 2000),
      }));
      fs.writeFileSync(apiPath, JSON.stringify(apiSummary, null, 2));
      console.log(`  API data saved: ${apiPath} (${raw.intercepted.length} responses)`);
      
      for (const resp of raw.intercepted) {
        try {
          const body = resp.body;
          
          // Parse minievents response — contains JSON arrays with event data
          // Format: ["eventId", [startMs, endMs, isAllDay], ..., ["title", "location", ...], ...]
          if (resp.url.includes('minievents') || resp.url.includes('fetcheventrange') || resp.url.includes('prefetcheventrange')) {
            // Strip the XSSI prefix )]}'
            const jsonStr = body.replace(/^\)\]\}'\n?/, '');
            let parsed;
            try { parsed = JSON.parse(jsonStr); } catch { continue; }
            
            // Walk the nested structure to find event arrays
            const extractEvents = (obj, depth = 0) => {
              if (!Array.isArray(obj) || depth > 10) return;
              
              // Check if this looks like an event: [eventId, [startMs, endMs, isAllDay], ...]
              if (obj.length > 7
                  && typeof obj[0] === 'string'
                  && Array.isArray(obj[1])
                  && typeof obj[1][0] === 'number'
                  && obj[1][0] > 1700000000000) { // timestamp after 2023
                
                const eventId = obj[0];
                const [startMs, endMs, isAllDay] = obj[1];
                const titleArr = obj[7]; // ["title", "description", ...]
                const title = Array.isArray(titleArr) ? titleArr[0] : null;
                const location = Array.isArray(titleArr) ? (titleArr[1] || '') : '';
                
                if (title && title.length > 0) {
                  const startDt = new Date(startMs);
                  const endDt = new Date(endMs);
                  const dateStr = fmtDate(startDt);
                  const startTime = isAllDay ? '(all day)' : startDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  const endTime = isAllDay ? '' : endDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  
                  apiEvents.push({
                    title,
                    date: dateStr,
                    startTime,
                    endTime,
                    isAllDay: !!isAllDay,
                    location,
                    eventId,
                    method: 'api-sync',
                  });
                }
                return; // Don't recurse into event arrays
              }
              
              // Recurse into nested arrays
              for (const item of obj) {
                if (Array.isArray(item)) extractEvents(item, depth + 1);
              }
            };
            
            extractEvents(parsed);
          }
        } catch {}
      }
    }

    // Merge and deduplicate — normalize dates and times for matching
    const normalizeDate = (d) => {
      if (!d) return '';
      // Already ISO format
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      // Strip day names: "Thursday, March 12" → "March 12"
      const cleaned = d.replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i, '')
        .replace(/, today$/, '');
      const parsed = new Date(cleaned + (cleaned.match(/\d{4}/) ? '' : ', 2026'));
      return isNaN(parsed) ? d : fmtDate(parsed);
    };
    const normalizeTime = (t) => {
      if (!t) return '';
      if (t === '(all day)') return 'allday';
      // "8am" → "8:00 AM", "8:30am" → "8:30 AM", "1pm" → "1:00 PM", "8:00 AM" stays
      let s = t.trim()
        .replace(/^(\d{1,2})(am|pm)$/i, '$1:00 $2')         // "8am" → "8:00 am"
        .replace(/^(\d{1,2}:\d{2})(am|pm)$/i, '$1 $2')       // "8:30am" → "8:30 am"
        .replace(/\s*(am|pm)\s*/i, m => ' ' + m.trim().toUpperCase()); // normalize AM/PM
      // Extract hour:minute for canonical form
      const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (m) return `${parseInt(m[1])}:${m[2]} ${m[3].toUpperCase()}`;
      return s;
    };

    const allEvents = [];
    const seen = new Set();

    // Prioritize API events (most structured), then chips
    for (const ev of [...apiEvents, ...chipEvents, ...textEvents]) {
      const normDate = normalizeDate(ev.date);
      const normTime = normalizeTime(ev.startTime);
      const title = ev.title.trim().replace(/\s+/g, ' ');
      const key = `${title}|${normDate}|${normTime}`;
      if (!seen.has(key) && title) {
        seen.add(key);
        ev.title = title;
        if (normDate) ev.date = normDate;
        allEvents.push(ev);
      }
    }

    // Sort by date then time
    allEvents.sort((a, b) => {
      const da = a.date || '', db = b.date || '';
      if (da !== db) return da < db ? -1 : 1;
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

    console.log(`\n  Parsed: ${allEvents.length} events (${chipEvents.length} chips, ${textEvents.length} text, ${apiEvents.length} api)\n`);

    // Save JSON
    const jsonOut = {
      source: 'google-calendar',
      account: userEmail,
      capturedAt: new Date().toISOString(),
      dateRange: { start: fmtDate(startDate), end: fmtDate(endDate) },
      daysBack: DAYS_BACK,
      daysFwd: DAYS_FWD,
      eventCount: allEvents.length,
      events: allEvents,
      rawTextLength: (raw.fullText || '').length,
    };
    const jsonPath = path.join(OUT_DIR, 'gcal-events.json');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2));
    console.log(`  JSON: ${jsonPath} (${(fs.statSync(jsonPath).size / 1024).toFixed(1)} KB)`);

    // Save readable text
    const txtLines = [
      `Google Calendar — ${userEmail || 'NFG'}`,
      `Captured: ${new Date().toISOString()}`,
      `Range: ${fmtDate(startDate)} → ${fmtDate(endDate)}`,
      `Events: ${allEvents.length}`,
      '',
      '═'.repeat(60),
      '',
    ];
    let lastDate = '';
    for (const ev of allEvents) {
      if (ev.date && ev.date !== lastDate) {
        txtLines.push(`\n── ${ev.date} ${'─'.repeat(40)}`);
        lastDate = ev.date;
      }
      const time = ev.startTime && ev.endTime ? `${ev.startTime} – ${ev.endTime}` : (ev.startTime || '');
      txtLines.push(`  ${time ? time + '  ' : ''}${ev.title}`);
    }
    const txtPath = path.join(OUT_DIR, 'gcal-events.txt');
    fs.writeFileSync(txtPath, txtLines.join('\n'));
    console.log(`  TXT:  ${txtPath} (${(fs.statSync(txtPath).size / 1024).toFixed(1)} KB)`);

    // Save raw text for debugging/fallback parsing
    const rawPath = path.join(OUT_DIR, 'gcal-raw-text.txt');
    fs.writeFileSync(rawPath, raw.fullText || '');
    console.log(`  RAW:  ${rawPath} (${((raw.fullText || '').length / 1024).toFixed(1)} KB)`);

    // Save capture summary
    const summary = {
      source: 'google-calendar',
      client: CLIENT,
      capturedAt: new Date().toISOString(),
      dateRange: { start: fmtDate(startDate), end: fmtDate(endDate) },
      eventCount: allEvents.length,
      totalChars: (raw.fullText || '').length,
      files: ['gcal-events.json', 'gcal-events.txt', 'gcal-raw-text.txt'],
    };
    fs.writeFileSync(path.join(OUT_DIR, '_capture-summary.json'), JSON.stringify(summary, null, 2));

    // Refresh auth state (tokens may have been refreshed during session)
    await context.storageState({ path: AUTH_STATE });

    console.log(`\n  ✅ Done — ${allEvents.length} events captured\n`);

  } catch (err) {
    console.error(`  ❌ Error: ${err.message}`);
  } finally {
    await browser.close();
  }
}

main();
