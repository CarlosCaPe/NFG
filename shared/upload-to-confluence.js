#!/usr/bin/env node
/**
 * upload-to-confluence.js
 * Converts a markdown file to Confluence storage format and uploads it as a new page.
 *
 * Usage:
 *   node shared/upload-to-confluence.js \
 *     --client oncohealth \
 *     --parent-id 5270437899 \
 *     --title "[POC] Iceberg REST Catalog" \
 *     --file clients/oncohealth/tickets/186438-iceberg-rest-catalog/output.md \
 *     [--attachments file1.png file2.pdf ...] \
 *     [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}
function getFlag(name) {
  return args.includes('--' + name);
}
function getListArg(name) {
  const i = args.indexOf('--' + name);
  if (i < 0) return [];
  const vals = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) {
    vals.push(args[j]);
  }
  return vals;
}

const client = getArg('client') || 'oncohealth';
const parentId = getArg('parent-id');
const title = getArg('title');
const mdFile = getArg('file');
const attachments = getListArg('attachments');
const dryRun = getFlag('dry-run');

if (!parentId || !title || !mdFile) {
  console.error('Usage: node upload-to-confluence.js --client <client> --parent-id <id> --title "<title>" --file <path> [--attachments f1 f2] [--dry-run]');
  process.exit(1);
}

// --- Load env ---
const envPath = path.join('clients', client, '.env');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2].trim();
});

const BASE = env.ATLASSIAN_BASE; // https://oncologyanalytics.atlassian.net
const AUTH = Buffer.from(env.ATLASSIAN_EMAIL + ':' + env.ATLASSIAN_API_TOKEN).toString('base64');

// --- Markdown to Confluence storage format ---
function mdToConfluence(md) {
  // Strip YAML frontmatter
  md = md.replace(/^---[\s\S]*?---\n*/m, '');

  let html = '';
  const lines = md.split('\n');
  let i = 0;
  let inCodeBlock = false;
  let codeLanguage = '';
  let codeContent = '';
  let inTable = false;
  let tableRows = [];

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inlineFormat(text) {
    // Bold + italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Auto-link bare URLs not already inside an href or <a> tag
    text = text.replace(/(?<!href="|">)(https?:\/\/[^\s<)"]+)/g, '<a href="$1">$1</a>');
    return text;
  }

  function flushTable() {
    if (!inTable || tableRows.length === 0) return;
    html += '<table><colgroup>';
    const cols = tableRows[0].length;
    for (let c = 0; c < cols; c++) html += '<col />';
    html += '</colgroup><tbody>';

    tableRows.forEach((row, ri) => {
      // Skip separator row (row of ---'s)
      if (row.every(cell => /^[-:]+$/.test(cell.trim()))) return;
      const tag = ri === 0 ? 'th' : 'td';
      html += '<tr>';
      row.forEach(cell => {
        html += `<${tag}>${inlineFormat(cell.trim())}</${tag}>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    tableRows = [];
    inTable = false;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flushTable();
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim() || 'none';
        codeContent = '';
        i++;
        continue;
      } else {
        // Map language names
        const langMap = { 'bash': 'bash', 'sql': 'sql', 'python': 'python', 'yaml': 'yaml', 'json': 'json', 'none': 'none', '': 'none' };
        const lang = langMap[codeLanguage.toLowerCase()] || codeLanguage;
        html += `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${escapeHtml(lang)}</ac:parameter><ac:plain-text-body><![CDATA[${codeContent}]]></ac:plain-text-body></ac:structured-macro>`;
        inCodeBlock = false;
        codeContent = '';
        i++;
        continue;
      }
    }
    if (inCodeBlock) {
      codeContent += (codeContent ? '\n' : '') + line;
      i++;
      continue;
    }

    // Table rows
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (!inTable) inTable = true;
      const cells = line.split('|').slice(1, -1); // remove first/last empty
      tableRows.push(cells);
      i++;
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headers
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      flushTable();
      const level = hMatch[1].length;
      html += `<h${level}>${inlineFormat(hMatch[2])}</h${level}>`;
      i++;
      continue;
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      flushTable();
      // Collect consecutive blockquote lines
      let bq = '';
      while (i < lines.length && lines[i].startsWith('> ')) {
        bq += (bq ? '<br />' : '') + inlineFormat(lines[i].slice(2));
        i++;
      }
      html += `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>${bq}</p></ac:rich-text-body></ac:structured-macro>`;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flushTable();
      html += '<hr />';
      i++;
      continue;
    }

    // Unordered list items
    if (/^[-*]\s/.test(line.trim())) {
      flushTable();
      html += '<ul>';
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        html += `<li>${inlineFormat(lines[i].trim().slice(2))}</li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }

    // Numbered list items
    if (/^\d+\.\s/.test(line.trim())) {
      flushTable();
      html += '<ol>';
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        html += `<li>${inlineFormat(lines[i].trim().replace(/^\d+\.\s/, ''))}</li>`;
        i++;
      }
      html += '</ol>';
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph
    flushTable();
    html += `<p>${inlineFormat(line)}</p>`;
    i++;
  }

  flushTable();
  return html;
}

// --- HTTPS request helper ---
function confluenceRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + apiPath);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Basic ' + AUTH,
        'Accept': 'application/json',
      }
    };
    if (body) {
      const payload = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request(options, handleRes);
      req.on('error', reject);
      req.write(payload);
      req.end();
    } else {
      const req = https.request(options, handleRes);
      req.on('error', reject);
      req.end();
    }

    function handleRes(res) {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: d ? JSON.parse(d) : null });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${d.substring(0, 500)}`));
        }
      });
    }
  });
}

// --- Upload attachment ---
function uploadAttachment(pageId, filePath) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const boundary = '----FormBoundary' + Date.now().toString(36);

    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const payload = Buffer.concat([
      Buffer.from(header),
      fileData,
      Buffer.from(footer)
    ]);

    const url = new URL(`${BASE}/wiki/rest/api/content/${pageId}/child/attachment`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'PUT',
      headers: {
        'Authorization': 'Basic ' + AUTH,
        'X-Atlassian-Token': 'nocheck',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length
      }
    };

    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: d ? JSON.parse(d) : null });
        } else {
          reject(new Error(`Attachment upload HTTP ${res.statusCode}: ${d.substring(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// --- Main ---
async function main() {
  console.log(`Reading ${mdFile}...`);
  const md = fs.readFileSync(mdFile, 'utf8');

  console.log('Converting markdown to Confluence storage format...');
  const storageBody = mdToConfluence(md);
  console.log(`  Converted: ${storageBody.length} chars of storage HTML`);

  // Get space key from parent
  console.log(`Fetching parent page ${parentId}...`);
  const parent = await confluenceRequest('GET', `/wiki/rest/api/content/${parentId}?expand=space`);
  const spaceKey = parent.data.space.key;
  console.log(`  Space: ${spaceKey}, Parent: "${parent.data.title}"`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would create page:');
    console.log(`  Title: ${title}`);
    console.log(`  Space: ${spaceKey}`);
    console.log(`  Parent: ${parent.data.title} (id: ${parentId})`);
    console.log(`  Body length: ${storageBody.length} chars`);
    console.log(`  Attachments: ${attachments.length}`);
    attachments.forEach(a => console.log(`    - ${a}`));
    // Write preview
    const previewPath = mdFile.replace(/\.md$/, '.confluence-preview.html');
    fs.writeFileSync(previewPath, storageBody);
    console.log(`  Preview saved: ${previewPath}`);
    return;
  }

  // Create page
  console.log(`Creating page "${title}" under "${parent.data.title}"...`);
  const createBody = {
    type: 'page',
    title: title,
    ancestors: [{ id: parentId }],
    space: { key: spaceKey },
    body: {
      storage: {
        value: storageBody,
        representation: 'storage'
      }
    }
  };

  const result = await confluenceRequest('POST', '/wiki/rest/api/content', createBody);
  const pageId = result.data.id;
  const pageUrl = BASE + '/wiki' + result.data._links.webui;
  console.log(`  Page created! ID: ${pageId}`);
  console.log(`  URL: ${pageUrl}`);

  // Upload attachments
  if (attachments.length > 0) {
    console.log(`\nUploading ${attachments.length} attachments...`);
    for (const att of attachments) {
      const fullPath = path.resolve(att);
      if (!fs.existsSync(fullPath)) {
        console.log(`  SKIP: ${att} (file not found)`);
        continue;
      }
      console.log(`  Uploading: ${path.basename(att)} (${(fs.statSync(fullPath).size / 1024).toFixed(1)} KB)...`);
      await uploadAttachment(pageId, fullPath);
      console.log(`    OK`);
    }
  }

  console.log('\nDone!');
  console.log(`Page URL: ${pageUrl}`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
