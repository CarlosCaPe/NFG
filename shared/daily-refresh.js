#!/usr/bin/env node
/**
 * Daily Refresh Orchestrator — Captures fresh data from all connected services.
 *
 * Runs each scraper sequentially, updates capture summaries, and logs results.
 * Designed for Windows Task Scheduler or manual invocation.
 *
 * Usage:
 *   node shared/daily-refresh.js --client oncohealth              (all services)
 *   node shared/daily-refresh.js --client oncohealth --only gcal   (single service)
 *   node shared/daily-refresh.js --client oncohealth --dry-run     (show plan only)
 *   node shared/daily-refresh.js --client oncohealth --skip ado    (skip one)
 *
 * Services (in execution order):
 *   gcal            — Google Calendar (NFG)           ~30s
 *   teams-cal       — Teams + Outlook Calendar         ~45s
 *   teams-channels  — Teams Channels (NoPHI + General) ~60s
 *   teams-chats     — Teams Chats (priority threads)   ~60s
 *   ado             — Azure DevOps work items          ~60s
 *   confluence      — Confluence spaces                ~90s
 *
 * Constraints:
 *   - Requires Playwright with headless=false (Okta SSO, Google login)
 *   - User must be logged into Windows session (not locked)
 *   - Auth states (.google-auth-state.json, storageState files) must be fresh
 *   - Cannot run in cloud (GitHub Actions, Azure Functions) — SSO requires browser
 *
 * Scheduling (Windows Task Scheduler):
 *   Action: node C:\Users\ccarrillo\NFG\shared\daily-refresh.js --client oncohealth
 *   Trigger: Daily at 08:00 (or on user logon)
 *   Conditions: Start only if user is logged on
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const clientArg = process.argv.indexOf('--client');
const CLIENT = clientArg !== -1 ? process.argv[clientArg + 1] : 'oncohealth';
const DRY_RUN = process.argv.includes('--dry-run');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg !== -1 ? process.argv[onlyArg + 1] : null;
const skipArg = process.argv.indexOf('--skip');
const SKIP = skipArg !== -1 ? process.argv[skipArg + 1] : null;

const LOG_DIR = path.join(ROOT, 'clients', CLIENT, 'output', 'refresh-logs');

// Service definitions — order matters (fastest/most-critical first)
const SERVICES = [
  {
    id: 'gcal',
    name: 'Google Calendar (NFG)',
    cmd: 'node shared/scrape-gcal.js --client {CLIENT} --back 7 --forward 14',
    output: 'gcal/gcal-events.json',
  },
  {
    id: 'teams-cal',
    name: 'Teams + Outlook Calendar',
    cmd: 'node shared/scrape-teams-calendar.js --client {CLIENT}',
    output: 'teams-daily/',
  },
  {
    id: 'teams-channels',
    name: 'Teams Channels (NoPHI + General)',
    cmd: 'node shared/scrape-teams-daily.js --client {CLIENT} --target channels',
    output: 'teams-daily/',
  },
  {
    id: 'teams-chats',
    name: 'Teams Chats (priority threads)',
    cmd: 'node shared/scrape-teams-daily.js --client {CLIENT} --target chats',
    output: 'teams-daily/',
  },
  {
    id: 'ado',
    name: 'Azure DevOps',
    cmd: 'node shared/scrape-ado-deep.js --client {CLIENT}',
    output: 'ado/_capture-summary.json',
  },
  {
    id: 'confluence',
    name: 'Confluence',
    cmd: 'node shared/scrape-confluence.js --client {CLIENT}',
    output: 'confluence/_capture-summary.json',
  },
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
}

async function main() {
  const ts = timestamp();
  console.log(`\n🔄 Daily Refresh — ${CLIENT}`);
  console.log(`   ${new Date().toISOString()}`);
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${ONLY ? ` (only: ${ONLY})` : ''}${SKIP ? ` (skip: ${SKIP})` : ''}\n`);

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const results = [];

  for (const svc of SERVICES) {
    if (ONLY && svc.id !== ONLY) continue;
    if (SKIP && svc.id === SKIP) {
      console.log(`  ⏭️  ${svc.name} — skipped`);
      results.push({ id: svc.id, name: svc.name, status: 'skipped' });
      continue;
    }

    const cmd = svc.cmd.replace('{CLIENT}', CLIENT);
    console.log(`  ▶️  ${svc.name}`);
    console.log(`     ${cmd}`);

    if (DRY_RUN) {
      results.push({ id: svc.id, name: svc.name, status: 'dry-run' });
      continue;
    }

    const start = Date.now();
    try {
      execSync(cmd, {
        cwd: ROOT,
        stdio: 'inherit',
        timeout: 300000, // 5 min per service
        env: { ...process.env },
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ✅ ${svc.name} — ${elapsed}s\n`);

      // Check output file exists and get size
      const outPath = path.join(ROOT, 'clients', CLIENT, 'output', svc.output);
      const exists = fs.existsSync(outPath);
      const size = exists && fs.statSync(outPath).isFile() ? fs.statSync(outPath).size : 0;

      results.push({ id: svc.id, name: svc.name, status: 'success', elapsed: parseFloat(elapsed), outputBytes: size });
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`  ❌ ${svc.name} failed (${elapsed}s): ${err.message}\n`);
      results.push({ id: svc.id, name: svc.name, status: 'error', elapsed: parseFloat(elapsed), error: err.message.substring(0, 200) });
    }
  }

  // Write log
  const logEntry = {
    timestamp: new Date().toISOString(),
    client: CLIENT,
    mode: DRY_RUN ? 'dry-run' : 'live',
    results,
    totalElapsed: results.reduce((s, r) => s + (r.elapsed || 0), 0),
    successCount: results.filter(r => r.status === 'success').length,
    errorCount: results.filter(r => r.status === 'error').length,
  };

  const logPath = path.join(LOG_DIR, `refresh-${ts}.json`);
  fs.writeFileSync(logPath, JSON.stringify(logEntry, null, 2));

  // Summary
  console.log('─'.repeat(50));
  console.log(`  Results: ${logEntry.successCount}/${results.length} success, ${logEntry.errorCount} errors`);
  console.log(`  Total:   ${logEntry.totalElapsed.toFixed(1)}s`);
  console.log(`  Log:     ${logPath}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
