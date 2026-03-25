#!/usr/bin/env node
/**
 * update-confluence-page.js
 * Updates an existing Confluence page with markdown content converted to storage format.
 * Embeds attached images inline.
 *
 * Usage:
 *   node shared/update-confluence-page.js \
 *     --client oncohealth \
 *     --page-id 5288493057 \
 *     --file clients/oncohealth/tickets/186438-iceberg-rest-catalog/closure-note.md \
 *     [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}
function getFlag(name) { return args.includes('--' + name); }

const client = getArg('client') || 'oncohealth';
const pageId = getArg('page-id');
const mdFile = getArg('file');
const dryRun = getFlag('dry-run');

if (!pageId || !mdFile) {
  console.error('Usage: --page-id <id> --file <path> [--client <c>] [--dry-run]');
  process.exit(1);
}

const envPath = path.join('clients', client, '.env');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2].trim();
});
const BASE = env.ATLASSIAN_BASE;
const AUTH = Buffer.from(env.ATLASSIAN_EMAIL + ':' + env.ATLASSIAN_API_TOKEN).toString('base64');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFormat(text) {
  // Bold+italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic (but not inside URLs or already-processed tags)
  text = text.replace(/(?<![/a-zA-Z])\*([^*]+?)\*(?![/a-zA-Z])/g, '<em>$1</em>');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Auto-link bare URLs not already inside an href or <a> tag
  text = text.replace(/(?<!href="|">)(https?:\/\/[^\s<)"]+)/g, '<a href="$1">$1</a>');
  return text;
}

function mdToConfluence(md) {
  // Strip YAML frontmatter
  md = md.replace(/^---[\s\S]*?---\n*/m, '');

  // Adapt repo-local references for Confluence audience
  md = md.replace(/`\.\.\/\.\.\/knowledge\.json`/g, 'project knowledge base');
  md = md.replace(/`\.\.\/\.\.\/output\/databricks\/`/g, 'Databricks workspace capture');
  md = md.replace(/Full report: `output\.md`/g, 'Full report attached as output.pdf');

  let html = '';
  const lines = md.split('\n');
  let i = 0;
  let inCodeBlock = false;
  let codeLanguage = '';
  let codeContent = '';
  let inTable = false;
  let tableRows = [];
  let inList = false;
  let listType = '';

  function flushTable() {
    if (!inTable || tableRows.length === 0) return;
    html += '<table data-layout="default"><colgroup>';
    const cols = tableRows[0].length;
    for (let c = 0; c < cols; c++) html += '<col />';
    html += '</colgroup><tbody>';
    tableRows.forEach((row, ri) => {
      if (row.every(cell => /^[-:]+$/.test(cell.trim()))) return;
      const tag = ri === 0 ? 'th' : 'td';
      html += '<tr>';
      row.forEach(cell => {
        html += `<${tag}><p>${inlineFormat(cell.trim())}</p></${tag}>`;
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
        const langMap = { bash: 'bash', sql: 'sql', python: 'py', yaml: 'yaml', json: 'json', none: 'none', '': 'none' };
        const lang = langMap[codeLanguage.toLowerCase()] || codeLanguage;
        html += `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${escapeHtml(lang)}</ac:parameter><ac:parameter ac:name="theme">Midnight</ac:parameter><ac:parameter ac:name="linenumbers">true</ac:parameter><ac:plain-text-body><![CDATA[${codeContent}]]></ac:plain-text-body></ac:structured-macro>`;
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
      const cells = line.split('|').slice(1, -1);
      tableRows.push(cells);
      i++;
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Inline images → Confluence attachment embeds
    const imgMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      flushTable();
      const alt = imgMatch[1];
      const src = imgMatch[2];
      const filename = path.basename(src);
      // Check if it's wrapped in center tags
      const isCentered = line.includes('<p align="center">');
      if (isCentered) {
        html += `<p style="text-align: center;"><ac:image ac:align="center" ac:width="800"><ri:attachment ri:filename="${escapeHtml(filename)}" /></ac:image></p>`;
      } else {
        html += `<p><ac:image ac:width="800"><ri:attachment ri:filename="${escapeHtml(filename)}" /></ac:image></p>`;
      }
      i++;
      continue;
    }

    // HTML image tags (for the centered diagram)
    const htmlImgMatch = line.match(/<p align="center"><img src="([^"]+)"[^/]*\/><\/p>/);
    if (htmlImgMatch) {
      flushTable();
      const filename = path.basename(htmlImgMatch[1]);
      html += `<p style="text-align: center;"><ac:image ac:align="center" ac:width="800"><ri:attachment ri:filename="${escapeHtml(filename)}" /></ac:image></p>`;
      i++;
      continue;
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

    // Blockquotes → Confluence info/note panels
    if (line.startsWith('> ')) {
      flushTable();
      let bqLines = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i].startsWith('>'))) {
        const content = lines[i].replace(/^>\s?/, '');
        bqLines.push(content);
        i++;
      }
      const bqHtml = bqLines.map(l => inlineFormat(l)).join('<br />');
      html += `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>${bqHtml}</p></ac:rich-text-body></ac:structured-macro>`;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flushTable();
      html += '<hr />';
      i++;
      continue;
    }

    // Unordered list items (handle nested)
    if (/^\s*[-*]\s/.test(line)) {
      flushTable();
      html += '<ul>';
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*]\s/, '');
        html += `<li><p>${inlineFormat(content)}</p></li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }

    // Numbered list items
    if (/^\s*\d+\.\s/.test(line)) {
      flushTable();
      html += '<ol>';
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+\.\s/, '');
        html += `<li><p>${inlineFormat(content)}</p></li>`;
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
    // Collect consecutive non-empty, non-special lines into one paragraph
    let paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('|') && !lines[i].startsWith('>') && !lines[i].startsWith('- ') && !lines[i].startsWith('* ') && !/^\d+\.\s/.test(lines[i]) && !lines[i].match(/^---+$/)) {
      paraLines.push(lines[i]);
      i++;
    }
    html += `<p>${inlineFormat(paraLines.join(' '))}</p>`;
  }

  flushTable();
  return html;
}

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

async function main() {
  console.log(`Reading ${mdFile}...`);
  const md = fs.readFileSync(mdFile, 'utf8');

  console.log('Converting to Confluence storage format...');
  const storageBody = mdToConfluence(md);
  console.log(`  Converted: ${storageBody.length} chars`);

  // Get current page version
  console.log(`Fetching page ${pageId}...`);
  const current = await confluenceRequest('GET', `/wiki/rest/api/content/${pageId}?expand=version,space`);
  const currentVersion = current.data.version.number;
  const spaceKey = current.data.space.key;
  const pageTitle = current.data.title;
  console.log(`  Title: "${pageTitle}", Version: ${currentVersion}, Space: ${spaceKey}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would update page:');
    console.log(`  New version: ${currentVersion + 1}`);
    console.log(`  Body length: ${storageBody.length} chars`);
    const previewPath = mdFile.replace(/\.md$/, '.confluence-preview.html');
    fs.writeFileSync(previewPath, storageBody);
    console.log(`  Preview: ${previewPath}`);
    return;
  }

  // Update page
  console.log(`Updating page to version ${currentVersion + 1}...`);
  const updateBody = {
    version: { number: currentVersion + 1 },
    title: pageTitle,
    type: 'page',
    body: {
      storage: {
        value: storageBody,
        representation: 'storage'
      }
    }
  };

  const result = await confluenceRequest('PUT', `/wiki/rest/api/content/${pageId}`, updateBody);
  const pageUrl = BASE + '/wiki' + result.data._links.webui;
  console.log(`  Updated! Version: ${result.data.version.number}`);
  console.log(`  URL: ${pageUrl}`);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
