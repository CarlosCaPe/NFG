/**
 * Confluence Deep Scraper — REST API with API Token auth.
 *
 * No browser needed. Uses Atlassian REST API v1 with Basic Auth (email + API token).
 * Captures all pages, labels, attachments metadata, and page trees from a Confluence space.
 *
 * Usage:
 *   node shared/scrape-confluence.js --client oncohealth
 *   node shared/scrape-confluence.js --client oncohealth --space NewUM
 *
 * Credentials: clients/<client>/.env
 *   ATLASSIAN_EMAIL=...
 *   ATLASSIAN_API_TOKEN=...
 *   ATLASSIAN_BASE=https://oncologyanalytics.atlassian.net
 *
 * Output: clients/<client>/output/confluence/
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const clientArg = process.argv.indexOf('--client');
const CLIENT = clientArg !== -1 ? process.argv[clientArg + 1] : 'oncohealth';
const spaceArg = process.argv.indexOf('--space');
const SPACE_KEY = spaceArg !== -1 ? process.argv[spaceArg + 1] : null; // null = discover all spaces
const OUT_DIR = path.join(ROOT, 'clients', CLIENT, 'output', 'confluence');

// Load .env
const envPath = path.join(ROOT, 'clients', CLIENT, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

const BASE_URL = process.env.ATLASSIAN_BASE || 'https://oncologyanalytics.atlassian.net';
const EMAIL = process.env.ATLASSIAN_EMAIL;
const TOKEN = process.env.ATLASSIAN_API_TOKEN;

if (!EMAIL || !TOKEN) {
  console.error('❌ Missing ATLASSIAN_EMAIL or ATLASSIAN_API_TOKEN in .env');
  process.exit(1);
}

const AUTH = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

// HTTP fetch helper (Node.js native, no dependencies)
function confluenceFetch(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${AUTH}`,
        'Accept': 'application/json',
        'User-Agent': 'NFG-Scraper/1.0',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          resolve({ _error: true, status: res.statusCode, statusText: res.statusMessage, body: data.substring(0, 500) });
        } else {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ _raw: data }); }
        }
      });
    });
    req.on('error', e => resolve({ _error: true, message: e.message }));
    req.end();
  });
}

// Paginated fetch — follows _links.next until exhausted
async function fetchAllPages(endpoint, limit = 50) {
  const allResults = [];
  let url = endpoint.includes('?') ? `${endpoint}&limit=${limit}` : `${endpoint}?limit=${limit}`;
  let pageNum = 0;

  while (url) {
    const data = await confluenceFetch(url);
    if (data._error) {
      if (pageNum === 0) return data; // Return error on first page
      break;
    }
    if (data.results) {
      allResults.push(...data.results);
      console.log(`    page ${++pageNum}: ${data.results.length} items (total: ${allResults.length})`);
    } else if (Array.isArray(data)) {
      allResults.push(...data);
      break;
    } else {
      allResults.push(data);
      break;
    }
    url = data._links?.next ? `${BASE_URL}${data._links.next}` : null;
  }

  return { results: allResults, count: allResults.length };
}

function save(name, data) {
  const filePath = path.join(OUT_DIR, name);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content, 'utf-8');
  const size = Buffer.byteLength(content, 'utf-8');
  console.log(`  → ${name} (${size.toLocaleString()} bytes)`);
  return size;
}

// Strip HTML tags and decode entities for readable text
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Confluence Deep Scraper (REST API + Token)     ║');
  console.log(`║  Base: ${BASE_URL.substring(0, 43)}  ║`);
  console.log('╚══════════════════════════════════════════════════╝');

  const stats = { spaces: 0, pages: 0, totalChars: 0, errors: [] };

  // ═══════════════════════════════════════════════════
  // 1. DISCOVER SPACES
  // ═══════════════════════════════════════════════════
  console.log('\n─── 1. SPACES ───');
  const spacesResult = await fetchAllPages('/wiki/rest/api/space?type=global&expand=description.plain');
  if (spacesResult._error) {
    console.error(`❌ Cannot access Confluence API: ${spacesResult.status} ${spacesResult.statusText}`);
    console.error(`   ${spacesResult.body || spacesResult.message}`);
    process.exit(1);
  }

  const allSpaces = spacesResult.results || [];
  save('00-spaces.json', allSpaces);
  console.log(`  Found ${allSpaces.length} space(s)`);

  for (const sp of allSpaces) {
    console.log(`    - ${sp.key}: ${sp.name} (type: ${sp.type})`);
  }
  stats.spaces = allSpaces.length;

  // Filter to requested space or process all
  const spacesToProcess = SPACE_KEY
    ? allSpaces.filter(s => s.key === SPACE_KEY)
    : allSpaces;

  if (SPACE_KEY && spacesToProcess.length === 0) {
    console.log(`\n⚠ Space "${SPACE_KEY}" not found. Trying to fetch it directly...`);
    const directSpace = await confluenceFetch(`/wiki/rest/api/space/${SPACE_KEY}?expand=description.plain`);
    if (!directSpace._error) {
      spacesToProcess.push(directSpace);
    } else {
      console.error(`❌ Space "${SPACE_KEY}" not accessible: ${directSpace.status}`);
      // Still continue with all spaces if any
    }
  }

  // ═══════════════════════════════════════════════════
  // 2. PROCESS EACH SPACE
  // ═══════════════════════════════════════════════════
  for (const space of spacesToProcess) {
    const spaceKey = space.key;
    const spaceSlug = spaceKey.toLowerCase().replace(/[^a-z0-9]/g, '_');
    console.log(`\n\n${'═'.repeat(50)}`);
    console.log(`  SPACE: ${space.name} (${spaceKey})`);
    console.log('═'.repeat(50));

    // 2a. Space details
    const spaceDetail = await confluenceFetch(`/wiki/rest/api/space/${spaceKey}?expand=description.plain,homepage`);
    if (!spaceDetail._error) {
      save(`01-space-${spaceSlug}-info.json`, spaceDetail);
    }

    // 2b. Get ALL pages with body content
    console.log('\n  ─── Pages ───');
    const pagesResult = await fetchAllPages(
      `/wiki/rest/api/content?spaceKey=${spaceKey}&type=page&expand=body.storage,version,ancestors,metadata.labels&status=current`,
      50
    );

    if (pagesResult._error) {
      console.log(`  ⚠ Cannot list pages: ${pagesResult.status}`);
      stats.errors.push({ space: spaceKey, section: 'pages', error: pagesResult });
      continue;
    }

    const pages = pagesResult.results || [];
    console.log(`  Total pages: ${pages.length}`);
    stats.pages += pages.length;

    // Save raw pages JSON (without body to keep it small)
    const pageIndex = pages.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      version: p.version?.number,
      created: p.version?.when,
      ancestors: (p.ancestors || []).map(a => ({ id: a.id, title: a.title })),
      labels: (p.metadata?.labels?.results || []).map(l => l.name),
      url: `${BASE_URL}/wiki${p._links?.webui || ''}`,
    }));
    save(`02-space-${spaceSlug}-page-index.json`, pageIndex);

    // Save each page's body as text + combined document
    let combinedText = `# ${space.name} — Full Content Export\n`;
    combinedText += `Exported: ${new Date().toISOString()}\n`;
    combinedText += `Pages: ${pages.length}\n\n`;

    // Build page tree (parent→children)
    const pageMap = {};
    const rootPages = [];
    for (const p of pages) {
      pageMap[p.id] = p;
      if (!p.ancestors || p.ancestors.length === 0) {
        rootPages.push(p);
      }
    }

    // Sort pages: root first, then by title
    const sortedPages = pages.sort((a, b) => {
      const depthA = a.ancestors?.length || 0;
      const depthB = b.ancestors?.length || 0;
      if (depthA !== depthB) return depthA - depthB;
      return (a.title || '').localeCompare(b.title || '');
    });

    for (const p of sortedPages) {
      const body = p.body?.storage?.value || '';
      const textContent = htmlToText(body);
      const depth = p.ancestors?.length || 0;
      const heading = '#'.repeat(Math.min(depth + 1, 4));

      combinedText += `\n${heading} ${p.title}\n`;
      if (p.metadata?.labels?.results?.length > 0) {
        combinedText += `Labels: ${p.metadata.labels.results.map(l => l.name).join(', ')}\n`;
      }
      combinedText += `\n${textContent}\n`;

      stats.totalChars += textContent.length;
    }

    const combined = save(`03-space-${spaceSlug}-full-content.txt`, combinedText);

    // 2c. Blog posts
    console.log('\n  ─── Blog Posts ───');
    const blogsResult = await fetchAllPages(
      `/wiki/rest/api/content?spaceKey=${spaceKey}&type=blogpost&expand=body.storage,version&status=current`,
      50
    );
    if (!blogsResult._error && blogsResult.results?.length > 0) {
      const blogs = blogsResult.results;
      console.log(`  Blog posts: ${blogs.length}`);
      let blogText = `# ${space.name} — Blog Posts\n\n`;
      for (const b of blogs) {
        const body = b.body?.storage?.value || '';
        blogText += `## ${b.title}\nDate: ${b.version?.when || '?'}\n\n${htmlToText(body)}\n\n`;
      }
      save(`04-space-${spaceSlug}-blogs.txt`, blogText);
    } else {
      console.log('  No blog posts');
    }

    // 2d. Labels in space
    console.log('\n  ─── Labels ───');
    const labelsResult = await fetchAllPages(
      `/wiki/rest/api/label?prefix=global&spaceKey=${spaceKey}`,
      200
    );
    if (!labelsResult._error && labelsResult.results?.length > 0) {
      save(`05-space-${spaceSlug}-labels.json`, labelsResult.results);
      console.log(`  Labels: ${labelsResult.results.length}`);
    } else {
      console.log('  No labels (or labels API unavailable)');
    }
  }

  // ═══════════════════════════════════════════════════
  // 3. SEARCH — recent content across all spaces
  // ═══════════════════════════════════════════════════
  console.log('\n\n─── 3. RECENT CONTENT SEARCH ───');
  const recentSearch = await confluenceFetch(
    `/wiki/rest/api/content/search?cql=type=page+order+by+lastmodified+desc&limit=50&expand=version,space`
  );
  if (!recentSearch._error && recentSearch.results) {
    const recentList = recentSearch.results.map(r => ({
      id: r.id,
      title: r.title,
      space: r.space?.key,
      modified: r.version?.when,
      modifiedBy: r.version?.by?.displayName,
    }));
    save('06-recent-content.json', recentList);
    console.log(`  Recent pages: ${recentList.length}`);
  }

  // ═══════════════════════════════════════════════════
  // 4. USERS / GROUPS (may be restricted)
  // ═══════════════════════════════════════════════════
  console.log('\n─── 4. GROUPS ───');
  const groups = await confluenceFetch('/wiki/rest/api/group?limit=50');
  if (!groups._error && groups.results) {
    save('07-groups.json', groups.results);
    console.log(`  Groups: ${groups.results.length}`);
  } else {
    console.log(`  ⚠ Groups: ${groups.status || 'not accessible'}`);
  }

  // ═══════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════
  console.log('\n\n' + '═'.repeat(50));
  console.log('  CONFLUENCE CAPTURE SUMMARY');
  console.log('═'.repeat(50));
  console.log(`  Spaces processed: ${stats.spaces}`);
  console.log(`  Pages captured: ${stats.pages}`);
  console.log(`  Total text chars: ${stats.totalChars.toLocaleString()}`);
  console.log(`  Output: ${OUT_DIR}`);

  const files = fs.readdirSync(OUT_DIR);
  let totalSize = 0;
  for (const f of files) {
    totalSize += fs.statSync(path.join(OUT_DIR, f)).size;
  }
  console.log(`  Files: ${files.length}`);
  console.log(`  Total size: ${(totalSize / 1024).toFixed(1)} KB`);

  if (stats.errors.length > 0) {
    console.log(`  Errors: ${stats.errors.length}`);
    for (const e of stats.errors) {
      console.log(`    - ${e.space}/${e.section}: ${e.error.status || e.error.message}`);
    }
  }

  save('_capture-summary.json', {
    captured: new Date().toISOString(),
    base: BASE_URL,
    spacesProcessed: stats.spaces,
    pagesCaptures: stats.pages,
    totalChars: stats.totalChars,
    files: files.length + 1,
    totalBytes: totalSize,
    errors: stats.errors,
  });

  console.log('\n✅ Confluence capture complete.');
})();
