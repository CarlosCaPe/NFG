// extension.js
// Entry point for the M365 Calendar & Transcripts VS Code extension.

const vscode = require('vscode');
const SidebarProvider = require('./sidebar');

/**
 * Called when the extension is activated (onStartupFinished).
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('[M365] Extension activated.');

    const provider = new SidebarProvider(context);

    // Register the Webview View for the sidebar
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('m365Sidebar', provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Command: Refresh calendar
    context.subscriptions.push(
        vscode.commands.registerCommand('m365.refresh', () => {
            provider.refresh();
        })
    );

    // Command: Login (trigger device-code flow manually)
    context.subscriptions.push(
        vscode.commands.registerCommand('m365.login', async () => {
            vscode.window.showInformationMessage(
                '[M365] Please check the OUTPUT panel for the device-code login link.'
            );
            provider.refresh();
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
