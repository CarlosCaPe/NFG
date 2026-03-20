/**
 * Microsoft Graph API Client — Teams & Calendar
 * 
 * Uses Device Code Flow for authentication (no app registration needed).
 * The user authenticates via browser, then we get an access token.
 * 
 * Commands:
 *   node graph-api.js login                   — Authenticate via device code flow
 *   node graph-api.js me                      — Get user profile
 *   node graph-api.js calendar [days]          — Get calendar events (default: 7 days)
 *   node graph-api.js teams                   — List joined Teams
 *   node graph-api.js channels <teamId>       — List channels in a team
 *   node graph-api.js chats [count]            — List recent chats
 *   node graph-api.js transcripts             — List available meeting transcripts
 *   node graph-api.js meetings [days]         — List online meetings (default: 7 days)
 *   node graph-api.js export-calendar <file>  — Export calendar to file
 * 
 * Auth: Device Code Flow with Microsoft's well-known client ID for CLI tools
 * Scopes: User.Read, Calendars.Read, OnlineMeetings.Read, Chat.Read, 
 *         OnlineMeetingTranscript.Read.All, Team.ReadBasic.All, Channel.ReadBasic.All
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '.graph-token.json');
const OUT_DIR = path.join(__dirname, 'output', 'graph');

// Microsoft Graph PowerShell SDK client ID (pre-approved in most orgs)
const CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e'; // Graph PowerShell
const TENANT = 'common'; // Multi-tenant + personal accounts
const SCOPES = [
  'User.Read',
  'Calendars.Read',
  'OnlineMeetings.Read', 
  'OnlineMeetingTranscript.Read.All',
  'Chat.Read',
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'ChannelMessage.Read.All'
].join(' ');

// ─── HTTP helpers ───────────────────────────────────────────────
function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function graphGet(endpoint, token) {
  return httpsRequest(`https://graph.microsoft.com/v1.0${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
}

function graphGetBeta(endpoint, token) {
  return httpsRequest(`https://graph.microsoft.com/beta${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
}

// ─── Token management ──────────────────────────────────────────
function saveToken(tokenData) {
  tokenData._saved_at = new Date().toISOString();
  tokenData._expires_at = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
}

function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  // Check if expired
  if (data._expires_at && new Date(data._expires_at) < new Date()) {
    console.log('⚠️  Token expired. Attempting refresh...');
    return { ...data, expired: true };
  }
  return data;
}

async function getToken() {
  const stored = loadToken();
  if (stored && !stored.expired) return stored.access_token;
  
  if (stored && stored.refresh_token) {
    const refreshed = await refreshToken(stored.refresh_token);
    if (refreshed) return refreshed;
  }
  
  console.error('❌ No valid token. Run: node graph-api.js login');
  process.exit(1);
}

async function refreshToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPES + ' offline_access',
  }).toString();

  const res = await httpsRequest(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    body
  );

  if (res.status === 200 && res.data.access_token) {
    console.log('🔄 Token refreshed successfully');
    saveToken(res.data);
    return res.data.access_token;
  }
  console.log('❌ Token refresh failed:', res.data?.error_description || res.status);
  return null;
}

// ─── Device Code Flow ──────────────────────────────────────────
async function login() {
  console.log('🔐 Microsoft Graph — Device Code Login\n');

  // Step 1: Request device code
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPES + ' offline_access',
  }).toString();

  const dcRes = await httpsRequest(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    body
  );

  if (dcRes.status !== 200) {
    console.error('❌ Device code request failed:', dcRes.raw);
    return;
  }

  const { device_code, user_code, verification_uri, message, interval, expires_in } = dcRes.data;
  
  console.log('━'.repeat(50));
  console.log(message);
  console.log('━'.repeat(50));
  console.log(`\nCode: ${user_code}`);
  console.log(`URL:  ${verification_uri}`);
  console.log(`\nWaiting for authentication (${expires_in}s timeout)...\n`);

  // Step 2: Poll for token
  const pollInterval = (interval || 5) * 1000;
  const maxAttempts = Math.ceil((expires_in || 900) / (interval || 5));

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, pollInterval));

    const tokenBody = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device_code,
    }).toString();

    const tokenRes = await httpsRequest(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      tokenBody
    );

    if (tokenRes.status === 200 && tokenRes.data.access_token) {
      saveToken(tokenRes.data);
      console.log('✅ Authenticated! Token saved to .graph-token.json');
      console.log(`   Expires: ${new Date(Date.now() + tokenRes.data.expires_in * 1000).toLocaleString()}`);
      
      // Quick profile check
      const me = await graphGet('/me', tokenRes.data.access_token);
      if (me.status === 200) {
        console.log(`   User: ${me.data.displayName} (${me.data.mail || me.data.userPrincipalName})`);
      }
      return;
    }

    if (tokenRes.data?.error === 'authorization_pending') {
      process.stdout.write('.');
      continue;
    }

    if (tokenRes.data?.error === 'expired_token') {
      console.log('\n❌ Device code expired. Run login again.');
      return;
    }

    console.log(`\n⚠️  Unexpected: ${tokenRes.data?.error}: ${tokenRes.data?.error_description}`);
  }
}

// ─── Commands ──────────────────────────────────────────────────
async function cmdMe() {
  const token = await getToken();
  const res = await graphGet('/me', token);
  if (res.status === 200) {
    const u = res.data;
    console.log(`Name:     ${u.displayName}`);
    console.log(`Email:    ${u.mail || u.userPrincipalName}`);
    console.log(`Job:      ${u.jobTitle || 'N/A'}`);
    console.log(`Office:   ${u.officeLocation || 'N/A'}`);
    console.log(`UPN:      ${u.userPrincipalName}`);
    console.log(`ID:       ${u.id}`);
  } else {
    console.error('Error:', res.data?.error?.message || res.status);
  }
}

async function cmdCalendar(days = 7) {
  const token = await getToken();
  const start = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();

  const res = await graphGet(
    `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=50&$select=subject,start,end,organizer,location,isOnlineMeeting,onlineMeetingUrl,bodyPreview`,
    token
  );

  if (res.status !== 200) {
    console.error('Error:', res.data?.error?.message || res.status);
    return;
  }

  const events = res.data.value || [];
  console.log(`📅 Calendar — next ${days} days (${events.length} events)\n`);

  for (const ev of events) {
    const startDt = new Date(ev.start.dateTime + 'Z').toLocaleString();
    const endDt = new Date(ev.end.dateTime + 'Z').toLocaleString();
    const online = ev.isOnlineMeeting ? ' 🎥' : '';
    console.log(`  ${startDt} → ${endDt}${online}`);
    console.log(`  📌 ${ev.subject}`);
    if (ev.organizer?.emailAddress?.name) console.log(`     Org: ${ev.organizer.emailAddress.name}`);
    if (ev.location?.displayName) console.log(`     Loc: ${ev.location.displayName}`);
    if (ev.bodyPreview) console.log(`     ${ev.bodyPreview.substring(0, 100)}...`);
    console.log('');
  }

  return events;
}

async function cmdExportCalendar(filename, days = 30) {
  const token = await getToken();
  const start = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();

  // Also get past events
  const pastStart = new Date(Date.now() - 30 * 86400000).toISOString();

  const [futureRes, pastRes] = await Promise.all([
    graphGet(`/me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100&$select=subject,start,end,organizer,location,isOnlineMeeting,onlineMeetingUrl,bodyPreview,attendees`, token),
    graphGet(`/me/calendarView?startDateTime=${pastStart}&endDateTime=${start}&$orderby=start/dateTime&$top=100&$select=subject,start,end,organizer,location,isOnlineMeeting,onlineMeetingUrl,bodyPreview,attendees`, token),
  ]);

  const allEvents = [
    ...(pastRes.data?.value || []),
    ...(futureRes.data?.value || []),
  ];

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, filename || 'calendar.json');
  fs.writeFileSync(outPath, JSON.stringify(allEvents, null, 2));
  console.log(`📅 Exported ${allEvents.length} events to ${outPath}`);

  // Also create a readable text version
  const txtPath = outPath.replace('.json', '.txt');
  const lines = allEvents.map(ev => {
    const startDt = new Date(ev.start.dateTime + 'Z').toLocaleString();
    const endDt = new Date(ev.end.dateTime + 'Z').toLocaleString();
    return `${startDt} — ${ev.subject} (Org: ${ev.organizer?.emailAddress?.name || 'N/A'})`;
  });
  fs.writeFileSync(txtPath, lines.join('\n'));
  console.log(`📝 Text version: ${txtPath}`);
}

async function cmdTeams() {
  const token = await getToken();
  const res = await graphGet('/me/joinedTeams', token);
  
  if (res.status !== 200) {
    console.error('Error:', res.data?.error?.message || res.status);
    return;
  }

  const teams = res.data.value || [];
  console.log(`👥 Joined Teams (${teams.length}):\n`);
  for (const t of teams) {
    console.log(`  ${t.displayName}`);
    console.log(`    ID: ${t.id}`);
    console.log(`    Desc: ${t.description || 'N/A'}`);
    console.log('');
  }
  return teams;
}

async function cmdChannels(teamId) {
  const token = await getToken();
  const res = await graphGet(`/teams/${teamId}/channels`, token);
  
  if (res.status !== 200) {
    console.error('Error:', res.data?.error?.message || res.status);
    return;
  }

  const channels = res.data.value || [];
  console.log(`📢 Channels (${channels.length}):\n`);
  for (const c of channels) {
    console.log(`  ${c.displayName} (${c.membershipType})`);
    console.log(`    ID: ${c.id}`);
    if (c.description) console.log(`    Desc: ${c.description}`);
    console.log('');
  }
  return channels;
}

async function cmdChats(count = 20) {
  const token = await getToken();
  const res = await graphGet(`/me/chats?$top=${count}&$orderby=lastMessagePreview/createdDateTime desc&$expand=lastMessagePreview`, token);
  
  if (res.status !== 200) {
    console.error('Error:', res.data?.error?.message || res.status);
    return;
  }

  const chats = res.data.value || [];
  console.log(`💬 Recent Chats (${chats.length}):\n`);
  for (const c of chats) {
    const topic = c.topic || c.chatType;
    const lastMsg = c.lastMessagePreview?.body?.content?.substring(0, 80) || '';
    const lastTime = c.lastMessagePreview?.createdDateTime ? new Date(c.lastMessagePreview.createdDateTime).toLocaleString() : '';
    console.log(`  [${c.chatType}] ${topic}`);
    if (lastTime) console.log(`    Last: ${lastTime} — ${lastMsg}`);
    console.log(`    ID: ${c.id}`);
    console.log('');
  }
  return chats;
}

async function cmdTranscripts() {
  const token = await getToken();
  
  // Get recent online meetings (past 30 days)
  const start = new Date(Date.now() - 30 * 86400000).toISOString();
  const end = new Date().toISOString();

  console.log('🔍 Searching for meetings with transcripts (past 30 days)...\n');

  // Get calendar events that were online meetings
  const calRes = await graphGet(
    `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$filter=isOnlineMeeting eq true&$select=subject,start,end,onlineMeeting&$orderby=start/dateTime desc&$top=50`,
    token
  );

  if (calRes.status !== 200) {
    console.error('Error fetching meetings:', calRes.data?.error?.message || calRes.status);
    return;
  }

  const meetings = calRes.data.value || [];
  console.log(`Found ${meetings.length} online meetings\n`);

  // Try to get transcripts for each meeting
  for (const m of meetings) {
    const joinUrl = m.onlineMeeting?.joinUrl;
    if (!joinUrl) continue;

    console.log(`📌 ${m.subject} (${new Date(m.start.dateTime + 'Z').toLocaleDateString()})`);

    // Get meeting ID from join URL
    try {
      // Use beta endpoint for transcripts
      const meetingRes = await graphGetBeta(
        `/me/onlineMeetings?$filter=JoinWebUrl eq '${encodeURIComponent(joinUrl)}'`,
        token
      );

      if (meetingRes.status === 200 && meetingRes.data.value?.length > 0) {
        const meetingId = meetingRes.data.value[0].id;

        const transcriptRes = await graphGetBeta(
          `/me/onlineMeetings/${meetingId}/transcripts`,
          token
        );

        if (transcriptRes.status === 200 && transcriptRes.data.value?.length > 0) {
          console.log(`   ✅ ${transcriptRes.data.value.length} transcript(s) available!`);
          
          for (const t of transcriptRes.data.value) {
            console.log(`      ID: ${t.id}`);
            console.log(`      Created: ${t.createdDateTime}`);
            
            // Download transcript content
            const contentRes = await graphGetBeta(
              `/me/onlineMeetings/${meetingId}/transcripts/${t.id}/content?$format=text/vtt`,
              token
            );
            
            if (contentRes.status === 200) {
              if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
              const safeName = m.subject.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50);
              const date = new Date(m.start.dateTime + 'Z').toISOString().split('T')[0];
              const outFile = path.join(OUT_DIR, `transcript-${date}-${safeName}.vtt`);
              fs.writeFileSync(outFile, contentRes.raw);
              console.log(`      📝 Saved: ${outFile}`);
            }
          }
        } else {
          console.log('   (no transcript)');
        }
      }
    } catch (e) {
      console.log(`   ⚠️  ${e.message}`);
    }
    console.log('');
  }
}

async function cmdMeetings(days = 7) {
  const token = await getToken();
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const end = new Date().toISOString();

  const res = await graphGet(
    `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$filter=isOnlineMeeting eq true&$select=subject,start,end,organizer,attendees,isOnlineMeeting,onlineMeeting,bodyPreview&$orderby=start/dateTime desc&$top=50`,
    token
  );

  if (res.status !== 200) {
    console.error('Error:', res.data?.error?.message || res.status);
    return;
  }

  const meetings = res.data.value || [];
  console.log(`🎥 Online meetings — past ${days} days (${meetings.length})\n`);

  for (const m of meetings) {
    const startDt = new Date(m.start.dateTime + 'Z').toLocaleString();
    console.log(`  ${startDt} — ${m.subject}`);
    console.log(`    Org: ${m.organizer?.emailAddress?.name || 'N/A'}`);
    if (m.attendees?.length) {
      const names = m.attendees.map(a => a.emailAddress?.name).filter(Boolean).join(', ');
      console.log(`    Attendees: ${names}`);
    }
    console.log('');
  }
  return meetings;
}

// ─── Main ──────────────────────────────────────────────────────
(async () => {
  const [cmd, ...args] = process.argv.slice(2);

  // Ensure .graph-token.json is in .gitignore
  const giPath = path.join(__dirname, '.gitignore');
  if (fs.existsSync(giPath)) {
    const gi = fs.readFileSync(giPath, 'utf-8');
    if (!gi.includes('.graph-token.json')) {
      fs.appendFileSync(giPath, '\n.graph-token.json\n');
      console.log('Added .graph-token.json to .gitignore');
    }
  }

  switch (cmd) {
    case 'login':
      await login();
      break;
    case 'me':
      await cmdMe();
      break;
    case 'calendar':
      await cmdCalendar(parseInt(args[0]) || 7);
      break;
    case 'export-calendar':
      await cmdExportCalendar(args[0] || 'calendar.json', parseInt(args[1]) || 30);
      break;
    case 'teams':
      await cmdTeams();
      break;
    case 'channels':
      if (!args[0]) { console.log('Usage: node graph-api.js channels <teamId>'); break; }
      await cmdChannels(args[0]);
      break;
    case 'chats':
      await cmdChats(parseInt(args[0]) || 20);
      break;
    case 'transcripts':
      await cmdTranscripts();
      break;
    case 'meetings':
      await cmdMeetings(parseInt(args[0]) || 7);
      break;
    default:
      console.log(`
Microsoft Graph API Client — Teams & Calendar

Commands:
  login                   Authenticate via device code flow
  me                      Show user profile
  calendar [days]         Show calendar events (default: 7 days)
  export-calendar [file]  Export 60 days of calendar to file
  teams                   List joined Teams
  channels <teamId>       List channels in a team
  chats [count]           List recent chats
  meetings [days]         Recent online meetings
  transcripts             Download meeting transcripts

Auth uses device code flow — open browser, paste code, sign in.
Token stored in .graph-token.json (auto-refresh via refresh_token).
      `.trim());
  }
})();
