// graph.js
// Microsoft Graph API client using Device Code Flow (no browser popup needed).
// Requires: @microsoft/microsoft-graph-client, @azure/identity, isomorphic-fetch

require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { DeviceCodeCredential } = require('@azure/identity');
const vscode = require('vscode');

// ─── Credential (singleton, reused across calls) ───────────────────────────
let _credential = null;

function getCredential() {
    if (_credential) return _credential;

    const config = vscode.workspace.getConfiguration('m365');
    const clientId = config.get('clientId') || process.env.M365_CLIENT_ID;
    const tenantId = config.get('tenantId') || process.env.M365_TENANT_ID || 'common';

    if (!clientId) {
        throw new Error(
            '[M365] Client ID not set. Add it via VS Code Settings → m365.clientId or set M365_CLIENT_ID env var.'
        );
    }

    _credential = new DeviceCodeCredential({
        clientId,
        tenantId,
        // The device-code message is shown in VS Code's Output channel.
        userPromptCallback: (info) => {
            vscode.window.showInformationMessage(
                `[M365 Login] Open ${info.verificationUri} and enter code: ${info.userCode}`
            );
            console.log('[M365 Login]', info.message);
        }
    });

    return _credential;
}

// ─── Graph Client ──────────────────────────────────────────────────────────
function getGraphClient() {
    const credential = getCredential();
    return Client.initWithMiddleware({
        authProvider: {
            getAccessToken: async () => {
                const token = await credential.getToken(
                    'https://graph.microsoft.com/.default'
                );
                return token.token;
            }
        }
    });
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Fetches the next N calendar events for the signed-in user.
 * Required permission: Calendars.Read
 * Endpoint: GET https://graph.microsoft.com/v1.0/me/events
 *
 * @param {number} top  Number of events to return (default 20)
 * @returns {Promise<Array>} Array of event objects
 */
async function getCalendarEvents(top = 20) {
    const client = getGraphClient();
    const now = new Date().toISOString();

    const result = await client
        .api('/me/events')
        .filter(`end/dateTime ge '${now}'`)
        .select('id,subject,start,end,onlineMeeting,onlineMeetingUrl,bodyPreview')
        .orderby('start/dateTime')
        .top(top)
        .get();

    return result.value || [];
}

/**
 * Fetches transcripts for a call record (Teams meeting).
 * Required permission: CallRecords.Read.All
 * Endpoint: GET https://graph.microsoft.com/v1.0/communications/callRecords/{id}/transcripts
 *
 * NOTE: callRecordId is different from the event ID.
 *       It is obtained from the onlineMeeting.joinUrl or via the callRecords subscription.
 *
 * @param {string} callRecordId
 * @returns {Promise<Array>} Array of transcript objects (may be empty if not available yet)
 */
async function getCallTranscripts(callRecordId) {
    const client = getGraphClient();

    const result = await client
        .api(`/communications/callRecords/${callRecordId}/transcripts`)
        .get();

    return result.value || [];
}

/**
 * Downloads the actual transcript content (VTT or text) for a specific transcript.
 * Endpoint: GET https://graph.microsoft.com/v1.0/communications/callRecords/{callRecordId}/transcripts/{transcriptId}/content
 *
 * @param {string} callRecordId
 * @param {string} transcriptId
 * @returns {Promise<string>} Transcript content as text
 */
async function getTranscriptContent(callRecordId, transcriptId) {
    const client = getGraphClient();

    // The content endpoint returns the raw VTT/text body
    const result = await client
        .api(
            `/communications/callRecords/${callRecordId}/transcripts/${transcriptId}/content`
        )
        .header('Accept', 'text/vtt')
        .get();

    // result may be a ReadableStream or Buffer depending on the Graph SDK version
    if (typeof result === 'string') return result;
    if (result && result.text) return await result.text();
    return JSON.stringify(result);
}

/**
 * Fetches online meeting details (including call record ID) from the join URL.
 * Required permission: OnlineMeetings.Read
 * Endpoint: GET https://graph.microsoft.com/v1.0/me/onlineMeetings?$filter=joinWebUrl eq '...'
 *
 * @param {string} joinWebUrl
 * @returns {Promise<object|null>} Online meeting object or null
 */
async function getOnlineMeetingByJoinUrl(joinWebUrl) {
    const client = getGraphClient();
    const encoded = encodeURIComponent(`joinWebUrl eq '${joinWebUrl}'`);

    const result = await client
        .api(`/me/onlineMeetings?$filter=${encoded}`)
        .get();

    return result.value?.[0] || null;
}

module.exports = {
    getCalendarEvents,
    getCallTranscripts,
    getTranscriptContent,
    getOnlineMeetingByJoinUrl
};
