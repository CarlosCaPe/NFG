// sidebar.js
// Webview sidebar provider: shows upcoming calendar events,
// and lets the user click to fetch & display Teams transcripts.

const vscode = require('vscode');
const {
    getCalendarEvents,
    getCallTranscripts,
    getTranscriptContent,
    getOnlineMeetingByJoinUrl
} = require('./graph');

class SidebarProvider {
    /** @param {vscode.ExtensionContext} context */
    constructor(context) {
        this._context = context;
        this._view = null;
    }

    /**
     * Called by VS Code when the webview view is resolved (first open / reveal).
     * @param {vscode.WebviewView} webviewView
     */
    resolveWebviewView(webviewView) {
        this._view = webviewView;

        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._loadingHtml();

        // Handle messages from the webview HTML
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'refresh':
                    await this.refresh();
                    break;
                case 'fetchTranscript':
                    await this._handleFetchTranscript(msg.event);
                    break;
            }
        });

        // Auto-load on open
        this.refresh();
    }

    /** Reload calendar events and re-render the sidebar. */
    async refresh() {
        if (!this._view) return;
        this._view.webview.html = this._loadingHtml();

        try {
            const events = await getCalendarEvents(20);
            this._view.webview.html = this._buildHtml(events);
        } catch (err) {
            this._view.webview.html = this._errorHtml(err.message);
        }
    }

    /**
     * Fetch transcript for a meeting event and show it in an editor tab.
     * @param {object} event  Serialised Graph event object from the webview.
     */
    async _handleFetchTranscript(event) {
        try {
            const joinUrl = event.onlineMeeting?.joinUrl || event.onlineMeetingUrl;

            if (!joinUrl) {
                vscode.window.showWarningMessage(
                    `[M365] No Teams join URL found for "${event.subject}". This may not be an online meeting.`
                );
                return;
            }

            vscode.window.showInformationMessage(
                `[M365] Fetching transcript for "${event.subject}"…`
            );

            // Step 1: resolve the meeting object to get the callRecord ID
            const meeting = await getOnlineMeetingByJoinUrl(joinUrl);
            if (!meeting) {
                vscode.window.showWarningMessage(
                    '[M365] Could not find the online meeting record. Make sure OnlineMeetings.Read is granted.'
                );
                return;
            }

            // Step 2: get list of transcripts (uses the meeting ID as callRecordId here;
            //         if you have the real callRecordId from a subscription, use that instead)
            const transcripts = await getCallTranscripts(meeting.id);

            if (!transcripts.length) {
                vscode.window.showWarningMessage(
                    `[M365] No transcripts available yet for "${event.subject}".`
                );
                return;
            }

            // Step 3: download the first (most recent) transcript content
            const latest = transcripts[0];
            const content = await getTranscriptContent(meeting.id, latest.id);

            // Step 4: open in a new editor tab as a virtual document
            const uri = vscode.Uri.parse(
                `untitled:Transcript - ${event.subject.replace(/[/\\:*?"<>|]/g, '_')}.vtt`
            );
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });

            await editor.edit((editBuilder) => {
                editBuilder.insert(new vscode.Position(0, 0), content);
            });

            vscode.window.showInformationMessage(
                `[M365] Transcript for "${event.subject}" loaded successfully.`
            );
        } catch (err) {
            vscode.window.showErrorMessage(`[M365] Transcript error: ${err.message}`);
        }
    }

    // ── HTML helpers ──────────────────────────────────────────────────────

    _loadingHtml() {
        return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:12px;">
            <p>⏳ Loading calendar…</p>
        </body></html>`;
    }

    _errorHtml(message) {
        return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:12px;color:red;">
            <b>Error:</b> <pre>${this._esc(message)}</pre>
            <p>Make sure you have set <code>m365.clientId</code> in VS Code settings and run
            <b>M365: Login</b> from the Command Palette.</p>
            <button onclick="acquireVsCodeApi().postMessage({command:'refresh'})">Retry</button>
        </body></html>`;
    }

    /**
     * Build the full sidebar HTML from the event list.
     * @param {Array} events
     */
    _buildHtml(events) {
        const rows = events.map((ev) => {
            const start = new Date(ev.start?.dateTime || ev.start?.date).toLocaleString();
            const end   = new Date(ev.end?.dateTime   || ev.end?.date  ).toLocaleString();
            const hasTeams = !!(ev.onlineMeeting?.joinUrl || ev.onlineMeetingUrl);
            const badge = hasTeams
                ? `<span style="background:#6264a7;color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;">Teams</span>`
                : '';

            // Serialise the event safely for the onclick handler
            const evJson = this._esc(JSON.stringify({
                id: ev.id,
                subject: ev.subject,
                onlineMeeting: ev.onlineMeeting,
                onlineMeetingUrl: ev.onlineMeetingUrl
            }));

            return `
            <div style="margin-bottom:14px;border-left:3px solid #0078d4;padding-left:8px;">
                <div style="font-weight:600;">${this._esc(ev.subject)} ${badge}</div>
                <div style="font-size:11px;color:#888;">${start} → ${end}</div>
                ${hasTeams ? `<button onclick='fetchTranscript(${evJson})'
                    style="margin-top:4px;cursor:pointer;background:#0078d4;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:11px;">
                    📄 Get Transcript
                </button>` : ''}
            </div>`;
        }).join('');

        const empty = events.length === 0
            ? '<p style="color:#888;">No upcoming events found.</p>'
            : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 10px; font-size: 12px; }
  button:hover { opacity: 0.85; }
</style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <b>📅 Upcoming Events</b>
    <button onclick="vscode.postMessage({command:'refresh'})"
      style="cursor:pointer;border:none;background:none;color:#0078d4;font-size:12px;">↻ Refresh</button>
  </div>
  ${empty}
  ${rows}
<script>
  const vscode = acquireVsCodeApi();
  function fetchTranscript(eventJson) {
    vscode.postMessage({ command: 'fetchTranscript', event: eventJson });
  }
</script>
</body>
</html>`;
    }

    /** HTML-escape a string to safely inject into HTML attributes / text. */
    _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

module.exports = SidebarProvider;
