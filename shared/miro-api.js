/**
 * Miro Board Extractor — uses REST API to extract all items from a board.
 *
 * Usage:
 *   node miro-api.js <command> [boardId]
 *
 * Commands:
 *   list              — list all boards in the team
 *   items <boardId>   — extract all items from a board
 *   export <boardId>  — export board items to text file
 *   all               — export ALL boards
 *
 * Token: reads MIRO_TOKEN from .env file or environment variable.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.+)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const TOKEN = process.env.MIRO_TOKEN;
if (!TOKEN) {
  console.error('❌ MIRO_TOKEN not set. Add it to .env file:\n  MIRO_TOKEN=your_access_token_here');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, 'output', 'onboarding-content');

// ---- API helpers ----

function miroGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.miro.com/v2${endpoint}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API ${res.statusCode}: ${data.substring(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getAllItems(boardId) {
  let allItems = [];
  let cursor = null;
  let page = 1;
  do {
    const endpoint = `/boards/${boardId}/items?limit=50${cursor ? `&cursor=${cursor}` : ''}`;
    console.log(`  Page ${page}...`);
    const resp = await miroGet(endpoint);
    allItems = allItems.concat(resp.data || []);
    cursor = resp.cursor;
    page++;
  } while (cursor);
  return allItems;
}

// ---- Commands ----

async function listBoards() {
  console.log('📋 Listing all boards...\n');
  const resp = await miroGet('/boards?limit=50');
  const boards = resp.data || [];
  console.log(`Found ${boards.length} boards:\n`);
  for (const b of boards) {
    console.log(`  [${b.id}] ${b.name || '(untitled)'}`);
    console.log(`    Created: ${b.createdAt} | Modified: ${b.modifiedAt}`);
    console.log(`    Link: ${b.viewLink || 'N/A'}`);
    console.log('');
  }
  return boards;
}

function extractText(item) {
  // Extract readable text from any Miro item type
  const parts = [];
  if (item.data?.content) {
    // Strip HTML tags
    const text = item.data.content.replace(/<[^>]+>/g, '').trim();
    if (text) parts.push(text);
  }
  if (item.data?.title) parts.push(item.data.title);
  if (item.data?.description) parts.push(item.data.description);
  if (item.data?.plainText) parts.push(item.data.plainText);
  // For cards
  if (item.data?.fields) {
    for (const f of item.data.fields) {
      if (f.value) parts.push(`${f.tooltip || f.fieldName || 'field'}: ${f.value}`);
    }
  }
  return parts.join(' | ');
}

async function exportBoard(boardId, filename) {
  console.log(`\n📦 Exporting board: ${boardId}`);

  // Get board info
  const board = await miroGet(`/boards/${boardId}`);
  console.log(`  Name: ${board.name || '(untitled)'}`);
  console.log(`  Description: ${board.description || '(none)'}`);

  // Get all items
  const items = await getAllItems(boardId);
  console.log(`  Total items: ${items.length}`);

  // Group by type
  const byType = {};
  for (const item of items) {
    const type = item.type || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(item);
  }

  // Build output
  const lines = [];
  lines.push(`# Miro Board: ${board.name || '(untitled)'}`);
  lines.push(`Board ID: ${boardId}`);
  lines.push(`Link: ${board.viewLink || 'N/A'}`);
  lines.push(`Created: ${board.createdAt}`);
  lines.push(`Modified: ${board.modifiedAt}`);
  lines.push(`Description: ${board.description || '(none)'}`);
  lines.push(`Total items: ${items.length}`);
  lines.push('');

  for (const [type, typeItems] of Object.entries(byType)) {
    lines.push(`\n## ${type} (${typeItems.length} items)\n`);
    for (const item of typeItems) {
      const text = extractText(item);
      const pos = item.position ? `(${Math.round(item.position.x)}, ${Math.round(item.position.y)})` : '';
      if (text) {
        lines.push(`- ${text} ${pos}`);
      } else {
        lines.push(`- [${type}] ${pos} (no text content)`);
      }
    }
  }

  // Save JSON (full data)
  const jsonPath = path.join(OUT_DIR, `${filename || boardId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ board, items }, null, 2), 'utf-8');
  console.log(`  JSON saved: ${jsonPath}`);

  // Save text
  const txtPath = path.join(OUT_DIR, `${filename || boardId}.txt`);
  const output = lines.join('\n');
  fs.writeFileSync(txtPath, output, 'utf-8');
  console.log(`  Text saved: ${txtPath} (${output.length} chars)`);

  return { board, items };
}

// ---- Main ----

(async () => {
  const cmd = process.argv[2] || 'list';
  const arg = process.argv[3];

  try {
    switch (cmd) {
      case 'list':
        await listBoards();
        break;

      case 'items': {
        if (!arg) { console.error('Usage: node miro-api.js items <boardId>'); process.exit(1); }
        const items = await getAllItems(arg);
        console.log(JSON.stringify(items, null, 2));
        break;
      }

      case 'export': {
        if (!arg) { console.error('Usage: node miro-api.js export <boardId> [filename]'); process.exit(1); }
        const filename = process.argv[4] || arg;
        await exportBoard(arg, filename);
        break;
      }

      case 'all': {
        const boards = await listBoards();
        for (const b of boards) {
          const safeName = (b.name || b.id).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
          await exportBoard(b.id, `miro-${safeName}`);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${cmd}. Use: list, items, export, all`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
})();
