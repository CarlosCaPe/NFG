# M365 Calendar & Transcripts — VS Code Extension

A VS Code extension that shows your **Outlook Calendar** in the sidebar and lets you download **Teams meeting transcripts** with one click.

---

## 1 · Azure App Registration (required first time)

### Step 1 — Create the App
1. Go to [https://portal.azure.com](https://portal.azure.com)
2. Navigate to **Azure Active Directory → App registrations → + New registration**
3. Fill in:
   - **Name**: `VSCode M365 Extension`
   - **Supported account types**: *Accounts in any organizational directory and personal Microsoft accounts*
   - **Redirect URI**: leave blank (Device Code Flow does not need one)
4. Click **Register** — copy the **Application (client) ID**

### Step 2 — Add API Permissions
Go to **API permissions → + Add a permission → Microsoft Graph → Delegated permissions** and add:

| Permission | Purpose |
|---|---|
| `User.Read` | Sign in & read basic profile |
| `Calendars.Read` | Read your Outlook calendar events |
| `OnlineMeetings.Read` | Resolve Teams meeting details by join URL |
| `CallRecords.Read.All` | Fetch call transcripts |

> ⚠️ `CallRecords.Read.All` requires **Admin Consent** in your tenant.  
> Ask your Microsoft 365 admin to click **Grant admin consent** on the permissions page.

### Step 3 — Enable Device Code Flow
No extra setting is needed — Device Code Flow is always available for Public Client apps.  
Optionally go to **Authentication → Advanced settings** and set  
*"Allow public client flows"* → **Yes**.

---

## 2 · VS Code Settings

Open **Settings (Ctrl+,)** and search `m365`:

| Setting | Description |
|---|---|
| `m365.clientId` | Your Azure App **Client ID** (required) |
| `m365.tenantId` | Your tenant ID or `common` for personal accounts |

Or add to `.vscode/settings.json`:
```json
{
  "m365.clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "m365.tenantId": "common"
}
```

---

## 3 · Installation

```bash
cd my-m365-extension
npm install
```

Then press **F5** in VS Code to launch an Extension Development Host, or package it:

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension m365-calendar-transcripts-1.0.0.vsix
```

---

## 4 · First Login (Device Code Flow)

1. Run command **M365: Login** from the Command Palette (`Ctrl+Shift+P`)
2. A notification will appear with a URL and a short code, e.g.:
   ```
   Open https://microsoft.com/devicelogin and enter code: ABC123DEF
   ```
3. Open the URL in any browser, enter the code, and sign in with your M365 account.
4. The extension automatically stores the token for future sessions.

---

## 5 · Usage

| Action | How |
|---|---|
| View upcoming events | Open the **Explorer** sidebar → **M365 Calendar** panel |
| Refresh events | Click **↻ Refresh** or run `M365: Refresh Calendar` |
| Get a transcript | Click **📄 Get Transcript** on any Teams event |
| View transcript | Opens in a new editor tab as a `.vtt` (WebVTT) file |

---

## 6 · Graph API Calls Used

```
GET https://graph.microsoft.com/v1.0/me/events
    ?$filter=end/dateTime ge '{now}'
    &$select=id,subject,start,end,onlineMeeting,onlineMeetingUrl
    &$orderby=start/dateTime
    &$top=20

GET https://graph.microsoft.com/v1.0/me/onlineMeetings
    ?$filter=joinWebUrl eq '{url}'

GET https://graph.microsoft.com/v1.0/communications/callRecords/{meetingId}/transcripts

GET https://graph.microsoft.com/v1.0/communications/callRecords/{meetingId}/transcripts/{transcriptId}/content
```

---

## 7 · Project Structure

```
my-m365-extension/
├── extension.js   ← VS Code entry point (activate/deactivate)
├── graph.js       ← All Microsoft Graph API calls
├── sidebar.js     ← Webview sidebar: HTML rendering + transcript fetch flow
├── package.json   ← Extension manifest + npm dependencies
└── README.md      ← This file
```

---

## 8 · Troubleshooting

| Problem | Solution |
|---|---|
| "Client ID not set" | Add `m365.clientId` in VS Code Settings |
| Transcripts list is empty | Meeting recording/transcript may not be processed yet (Teams takes a few minutes after the meeting ends) |
| `CallRecords.Read.All` error | Needs admin consent — ask your M365 admin |
| Device code prompt doesn't appear | Run `M365: Login` from the Command Palette, then check the VS Code notification bell |

---

## 9 · Optional Enhancements (next steps)

- [ ] Save transcripts as `.md` or `.txt` to disk
- [ ] AI summary of transcripts (call Azure OpenAI / GitHub Copilot API)
- [ ] Show Teams recording links alongside transcripts
- [ ] TreeView instead of Webview for the calendar list
- [ ] Token cache persistence across VS Code restarts
