import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('TEST EXTENSION ACTIVATED!!!');
    
    const channel = vscode.window.createOutputChannel('TEST OUTPUT');
    channel.appendLine('This is a test');
    channel.show();
}

export function deactivate() {}
