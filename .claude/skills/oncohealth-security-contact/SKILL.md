---
name: oncohealth-security-contact
description: Security contact and IT policies for OncoHealth engagement. Roman Zorii is the IT security POC. Covers CrowdStrike, JumpCloud, Playwright cookie restrictions, and approved workarounds. Trigger when dealing with security alerts, antivirus blocks, browser automation restrictions, CrowdStrike, JumpCloud, or IT compliance on the OncoHealth laptop.
---

# OncoHealth Security Contact & IT Policies

## Security POC

- **Roman Zorii** — IT Security. Direct contact via Teams chat.

## Laptop Requirements

- **CrowdStrike**: Must be running. Laptop needs 1+ hour online for all policies to apply.
- **JumpCloud**: Must be syncing. If both JumpCloud and CrowdStrike stop syncing simultaneously, Roman will schedule a reinstall.
- **Uptime**: Laptop must come online regularly. Roman monitors device status and will flag if offline for extended periods.

## Playwright / Browser Automation Restrictions

### Blocked Behavior

CrowdStrike blocks `esentutl.exe` cookie copying — Playwright's default persistent-context mechanism for Edge/Chrome. This is flagged as malware-like (credential theft pattern).

**No antivirus exception will be granted** for `esentutl.exe` cookie copying.

### Approved Alternatives

Roman's approved workarounds:
1. **`storageState`** — Playwright's JSON-based auth state (cookies + localStorage export/import)
2. **API tokens** — Use service API tokens instead of browser session cookies
3. **Special security approval** — Last resort if completely blocked. Requires formal request through Roman.

### What Happened (2026-03 Incident)

1. `miro-login-capture.js` used Playwright persistent context to read Miro boards
2. Playwright internally used `esentutl.exe` to copy Edge session cookies
3. CrowdStrike blocked it and Roman flagged the activity
4. Carlos confirmed it was authorized testing, explained the workflow
5. Roman denied antivirus exception, recommended `storageState` or API tokens
6. **Resolution**: Use Miro REST API (`shared/miro-api.js`) instead of browser automation for Miro. For other browser automation, use `storageState` pattern.

### storageState Pattern (Preferred)

```javascript
// Step 1: Manual login, save state
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://target-site.com');
// ... manual login ...
await context.storageState({ path: 'auth-state.json' });

// Step 2: Reuse state (no esentutl.exe)
const context = await browser.newContext({ storageState: 'auth-state.json' });
```

## Communication Protocol

- If CrowdStrike blocks a script → check if it uses persistent browser context → switch to `storageState`
- If Roman flags something → respond promptly with full transparency (script name, purpose, workflow)
- Always disclose automation tooling when asked
