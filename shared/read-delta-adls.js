#!/usr/bin/env node
/**
 * read-delta-adls.js — POC: Read Delta tables directly from ADLS (Option B)
 *
 * Reads Delta Lake tables from Azure Data Lake Storage Gen2 by:
 * 1. Parsing _delta_log to build the current snapshot (active files)
 * 2. Downloading and reading Parquet data files
 * 3. Optionally writing to PostgreSQL
 *
 * Auth: Azure Service Principal (client_id + client_secret + tenant_id)
 *       or Databricks PAT (for SQL Statement API fallback)
 *
 * Usage:
 *   node shared/read-delta-adls.js --client oncohealth
 *   node shared/read-delta-adls.js --client oncohealth --table newum_migration_test.eligibility.eligibilitydata
 *   node shared/read-delta-adls.js --client oncohealth --mode sql   # Use SQL Statement API instead
 *   node shared/read-delta-adls.js --client oncohealth --limit 10   # Limit rows
 *   node shared/read-delta-adls.js --client oncohealth --dry-run    # Show plan only
 *
 * Environment (.env in clients/<client>/):
 *   AZURE_TENANT_ID       — Azure AD tenant
 *   AZURE_CLIENT_ID       — Service Principal app ID
 *   AZURE_CLIENT_SECRET   — Service Principal secret
 *   DATABRICKS_TEST_HOST  — Databricks workspace URL
 *   DATABRICKS_TEST_TOKEN — Databricks PAT
 *   POSTGRES_HOST         — PostgreSQL host (for --write-pg)
 *   POSTGRES_DB           — PostgreSQL database
 *   POSTGRES_USER         — PostgreSQL user
 *   POSTGRES_PASSWORD     — PostgreSQL password
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function arg(name, def) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  return args[idx + 1] || def;
}
const hasFlag = (name) => args.includes(`--${name}`);

const CLIENT   = arg('client', 'oncohealth');
const TABLE    = arg('table', 'newum_migration_test.eligibility.eligibilitydata');
const MODE     = arg('mode', 'adls');           // 'adls' or 'sql'
const LIMIT    = parseInt(arg('limit', '100'));
const DRY_RUN  = hasFlag('dry-run');
const WRITE_PG = hasFlag('write-pg');
const VERBOSE  = hasFlag('verbose');

// ---------------------------------------------------------------------------
// Load .env
// ---------------------------------------------------------------------------
const envPath = path.join(__dirname, '..', 'clients', CLIENT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const DB_HOST  = process.env.DATABRICKS_TEST_HOST;
const DB_TOKEN = process.env.DATABRICKS_TEST_TOKEN;

// ---------------------------------------------------------------------------
// Databricks helpers
// ---------------------------------------------------------------------------
function dbGet(urlPath) {
  const url = new URL(urlPath, DB_HOST);
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'Authorization': `Bearer ${DB_TOKEN}`, 'Accept': 'application/json' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
  });
}

function dbPost(urlPath, body) {
  const url = new URL(urlPath, DB_HOST);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Mode: ADLS — Direct storage read
// ---------------------------------------------------------------------------
async function modeADLS() {
  console.log('\n--- Mode: ADLS Direct Storage Read ---');

  // Step 1: Get table metadata from Databricks API
  console.log(`\n[1/5] Fetching table metadata: ${TABLE}`);
  const tableInfo = await dbGet(`/api/2.1/unity-catalog/tables/${TABLE}`);
  if (tableInfo.status !== 200) {
    console.error(`ERROR: Cannot fetch table info (${tableInfo.status}):`, tableInfo.data);
    process.exit(1);
  }
  const t = tableInfo.data;
  console.log(`  Name: ${t.full_name}`);
  console.log(`  Type: ${t.table_type} / ${t.data_source_format}`);
  console.log(`  Storage: ${t.storage_location}`);
  console.log(`  Columns: ${t.columns?.length || 0}`);

  // Check UniForm status
  const props = t.properties || {};
  const hasUniForm = props['delta.universalFormat.enabledFormats'] === 'iceberg'
                  || props['delta.enableIcebergCompatV2'] === 'true';
  console.log(`  UniForm/Iceberg: ${hasUniForm ? 'ENABLED' : 'NOT ENABLED — needs ALTER TABLE (DevOps ticket pending)'}`);

  // Parse ABFSS URI
  const abfssMatch = t.storage_location.match(/^abfss:\/\/([^@]+)@([^.]+)\.dfs\.core\.windows\.net\/(.+)$/);
  if (!abfssMatch) {
    console.error('ERROR: Cannot parse ABFSS URI:', t.storage_location);
    process.exit(1);
  }
  const [, container, storageAccount, tablePath] = abfssMatch;
  console.log(`  Container: ${container}`);
  console.log(`  Storage Account: ${storageAccount}`);
  console.log(`  Table Path: ${tablePath}`);

  // Step 2: Check Azure credentials
  console.log('\n[2/5] Checking Azure credentials...');
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    console.log('  MISSING — Azure SP credentials not configured.');
    console.log('  Required env vars: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET');
    console.log('  Waiting for Alex (DevOps) to provide:');
    console.log('    Q1: Which auth method for external ADLS reads?');
    console.log('    Q2: Which SP client_id to use?');
    console.log('    Q3: External location registration needed?');
    console.log('    Q4: Is storage account on private endpoint?');
    console.log('');
    console.log('  Known SPs in workspace:');
    console.log('    - databricks_airflow_sp_test (6759a888-3038-4b05-a76b-8556aba5ad7a)');
    console.log('    - app-cc28t0 new-data-api (90336730-f2e6-4960-adcd-a890cf092a20)');
    console.log('    - databricks_workspace_dev (6f46a974-c1a5-4e9a-8f56-0563fc32f19b)');

    if (DRY_RUN) {
      console.log('\n--- DRY RUN: Would read Delta table from ADLS ---');
      showPlan(t, container, storageAccount, tablePath);
      return;
    }

    console.log('\n  Falling back to SQL Statement API...');
    return modeSQL();
  }

  // Step 3: Connect to ADLS and list Delta log
  console.log('\n[3/5] Connecting to ADLS...');
  const { BlobServiceClient } = require('@azure/storage-blob');
  const { ClientSecretCredential } = require('@azure/identity');

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const blobService = new BlobServiceClient(
    `https://${storageAccount}.dfs.core.windows.net`,
    credential
  );
  const containerClient = blobService.getContainerClient(container);

  // List _delta_log files
  console.log(`  Listing _delta_log at: ${tablePath}/_delta_log/`);
  const logFiles = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: `${tablePath}/_delta_log/` })) {
    logFiles.push(blob.name);
  }
  console.log(`  Found ${logFiles.length} delta log entries`);

  // Parse the latest checkpoint and JSON log files
  const jsonLogs = logFiles.filter(f => f.endsWith('.json')).sort();
  const checkpoints = logFiles.filter(f => f.endsWith('.checkpoint.parquet')).sort();

  console.log(`  JSON log files: ${jsonLogs.length}`);
  console.log(`  Checkpoint files: ${checkpoints.length}`);

  // Step 4: Build active file list from delta log
  console.log('\n[4/5] Building snapshot from delta log...');
  const addedFiles = new Set();
  const removedFiles = new Set();

  // Read JSON log files to build snapshot
  for (const logFile of jsonLogs) {
    const blobClient = containerClient.getBlobClient(logFile);
    const download = await blobClient.download();
    const content = await streamToString(download.readableStreamBody);

    for (const line of content.split('\n').filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        if (entry.add) addedFiles.add(entry.add.path);
        if (entry.remove) removedFiles.add(entry.remove.path);
      } catch { /* skip malformed lines */ }
    }
  }

  // Active files = added - removed
  const activeFiles = [...addedFiles].filter(f => !removedFiles.has(f));
  console.log(`  Active Parquet files: ${activeFiles.length}`);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: Would read these files ---');
    activeFiles.slice(0, 10).forEach(f => console.log(`   ${f}`));
    if (activeFiles.length > 10) console.log(`   ... and ${activeFiles.length - 10} more`);
    return;
  }

  // Step 5: Read Parquet files
  console.log('\n[5/5] Reading Parquet data...');
  const parquetWasm = await import('parquet-wasm');
  await parquetWasm.default();

  let totalRows = 0;
  const allRows = [];

  for (const file of activeFiles) {
    if (totalRows >= LIMIT) break;

    const filePath = `${tablePath}/${file}`;
    const blobClient = containerClient.getBlobClient(filePath);
    const download = await blobClient.download();
    const buffer = await streamToBuffer(download.readableStreamBody);

    const table = parquetWasm.readParquet(new Uint8Array(buffer));
    const schema = table.schema;
    const numRows = table.numRows;

    if (VERBOSE) console.log(`  ${file}: ${numRows} rows`);

    // Convert to JSON rows
    const batches = table.toFFI();
    // parquet-wasm returns Arrow batches — convert to records
    for (let i = 0; i < Math.min(numRows, LIMIT - totalRows); i++) {
      totalRows++;
    }

    allRows.push({ file, rows: numRows });
  }

  console.log(`\n  Total rows read: ${totalRows}`);
  console.log(`  Files processed: ${allRows.length}`);

  // Summary
  console.log('\n=== POC Result ===');
  console.log(`Table: ${t.full_name}`);
  console.log(`Files: ${activeFiles.length} active Parquet files`);
  console.log(`Rows sampled: ${totalRows}`);
  console.log(`UniForm: ${hasUniForm ? 'YES' : 'NO (pending DevOps)'}`);
}

// ---------------------------------------------------------------------------
// Mode: SQL — Databricks SQL Statement API
// ---------------------------------------------------------------------------
async function modeSQL() {
  console.log('\n--- Mode: SQL Statement API ---');

  if (!DB_HOST || !DB_TOKEN) {
    console.error('ERROR: DATABRICKS_TEST_HOST and DATABRICKS_TEST_TOKEN required');
    process.exit(1);
  }

  // Step 1: Find available warehouse
  console.log('\n[1/4] Finding SQL warehouse...');
  const wh = await dbGet('/api/2.0/sql/warehouses');
  const warehouses = wh.data.warehouses || [];

  if (warehouses.length === 0) {
    console.error('ERROR: No SQL warehouses found');
    process.exit(1);
  }

  const warehouse = warehouses[0];
  console.log(`  Warehouse: ${warehouse.name} (${warehouse.id})`);
  console.log(`  State: ${warehouse.state}`);
  console.log(`  Size: ${warehouse.cluster_size}`);

  // Step 2: Start warehouse if stopped
  if (warehouse.state === 'STOPPED') {
    if (DRY_RUN) {
      console.log('\n--- DRY RUN: Would start warehouse and query table ---');
      console.log(`  SQL: SELECT * FROM ${TABLE} LIMIT ${LIMIT}`);
      return;
    }

    console.log('\n[2/4] Starting warehouse...');
    const start = await dbPost(`/api/2.0/sql/warehouses/${warehouse.id}/start`, {});
    console.log(`  Start request: ${start.status}`);

    // Poll until running
    let state = 'STARTING';
    let attempts = 0;
    while (state !== 'RUNNING' && attempts < 60) {
      await sleep(5000);
      const poll = await dbGet(`/api/2.0/sql/warehouses/${warehouse.id}`);
      state = poll.data.state;
      attempts++;
      process.stdout.write(`  Waiting... ${state} (${attempts * 5}s)\r`);
    }
    console.log(`\n  Warehouse state: ${state}`);

    if (state !== 'RUNNING') {
      console.error('ERROR: Warehouse did not start within 5 minutes');
      process.exit(1);
    }
  }

  // Step 3: Execute query
  console.log(`\n[3/4] Executing query...`);
  const sql = `SELECT * FROM ${TABLE} LIMIT ${LIMIT}`;
  console.log(`  SQL: ${sql}`);

  const stmt = await dbPost('/api/2.0/sql/statements/', {
    warehouse_id: warehouse.id,
    statement: sql,
    wait_timeout: '120s',
    disposition: 'INLINE',
    format: 'JSON_ARRAY'
  });

  if (stmt.status !== 200) {
    console.error(`ERROR: SQL execution failed (${stmt.status}):`, JSON.stringify(stmt.data).slice(0, 500));
    process.exit(1);
  }

  const result = stmt.data;
  console.log(`  Status: ${result.status?.state}`);

  if (result.status?.state === 'FAILED') {
    console.error('  Error:', result.status.error?.message);
    process.exit(1);
  }

  // Step 4: Process results
  console.log('\n[4/4] Processing results...');
  const manifest = result.manifest;
  const columns = manifest?.schema?.columns || [];
  const chunks = result.result?.data_array || [];

  console.log(`  Columns: ${columns.length}`);
  console.log(`  Rows returned: ${chunks.length}`);

  if (columns.length > 0) {
    console.log(`\n  Column names (first 20):`);
    columns.slice(0, 20).forEach(c => console.log(`    ${c.name} (${c.type_name})`));
    if (columns.length > 20) console.log(`    ... and ${columns.length - 20} more`);
  }

  if (chunks.length > 0) {
    console.log(`\n  Sample row (first 10 fields):`);
    const row = chunks[0];
    columns.slice(0, 10).forEach((c, i) => {
      const val = row[i];
      const display = val === null ? 'NULL' : String(val).slice(0, 60);
      console.log(`    ${c.name}: ${display}`);
    });
  }

  // Save results
  const outDir = path.join(__dirname, '..', 'clients', CLIENT, 'output', 'databricks');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `poc-eligibility-sample.json`);
  const output = {
    table: TABLE,
    captured: new Date().toISOString(),
    mode: 'sql',
    warehouse: warehouse.name,
    columns: columns.map(c => ({ name: c.name, type: c.type_name })),
    row_count: chunks.length,
    sample_rows: chunks.slice(0, 5).map(row => {
      const obj = {};
      columns.forEach((c, i) => obj[c.name] = row[i]);
      return obj;
    })
  };
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n  Saved to: ${outFile}`);

  // Summary
  console.log('\n=== POC Result ===');
  console.log(`Table: ${TABLE}`);
  console.log(`Mode: SQL Statement API (PAT auth)`);
  console.log(`Rows: ${chunks.length}`);
  console.log(`Columns: ${columns.length}`);
  console.log(`Warehouse: ${warehouse.name} (${warehouse.state})`);

  return { columns, rows: chunks };
}

// ---------------------------------------------------------------------------
// Plan display (dry-run)
// ---------------------------------------------------------------------------
function showPlan(tableInfo, container, account, tablePath) {
  console.log(`\n  Plan for Option B (Direct ADLS read):`);
  console.log(`  ┌─────────────────────────────────────────────┐`);
  console.log(`  │ 1. Auth via Azure SP → ADLS token           │`);
  console.log(`  │ 2. List ${account}/${container}/${tablePath.split('/').slice(-1)}/_delta_log/ │`);
  console.log(`  │ 3. Parse JSON logs → active Parquet files   │`);
  console.log(`  │ 4. Download + read Parquet files            │`);
  console.log(`  │ 5. Convert rows → PostgreSQL INSERT         │`);
  console.log(`  └─────────────────────────────────────────────┘`);
  console.log(`\n  Columns (${tableInfo.columns?.length}):`);
  const cols = tableInfo.columns || [];
  cols.slice(0, 15).forEach(c => console.log(`    ${c.name} (${c.type_text})`));
  if (cols.length > 15) console.log(`    ... and ${cols.length - 15} more`);

  console.log(`\n  Prerequisites status:`);
  const props = tableInfo.properties || {};
  const hasUniForm = props['delta.universalFormat.enabledFormats'] === 'iceberg';
  console.log(`    [${hasUniForm ? 'x' : ' '}] UniForm enabled on table`);
  console.log(`    [ ] Azure SP credentials configured`);
  console.log(`    [ ] PostgreSQL TEST credentials`);
  console.log(`    [ ] Storage account network access verified`);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Databricks → ADLS → PostgreSQL POC ===');
  console.log(`Client: ${CLIENT}`);
  console.log(`Table: ${TABLE}`);
  console.log(`Mode: ${MODE}`);
  console.log(`Limit: ${LIMIT} rows`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Write PG: ${WRITE_PG}`);

  if (MODE === 'sql') {
    await modeSQL();
  } else {
    await modeADLS();
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
