import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { extractPythonImports } from './utils';

export interface Dependency {
    module: string;
    alias?: string;
    files: string[];
}

export class DependencyManager {
    private dependencies: Map<string, Dependency> = new Map();

    public async scanWorkspace(): Promise<void> {
        this.dependencies.clear();

        const files = await vscode.workspace.findFiles('**/*.fr', '**/node_modules/**');

        for (const file of files) {
            await this.scanFile(file);
        }
    }

    private async scanFile(uri: vscode.Uri): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const imports = extractPythonImports(document);

        imports.forEach((value, key) => {
            const module = value.module;
            
            if (this.dependencies.has(module)) {
                const dep = this.dependencies.get(module)!;
                if (!dep.files.includes(uri.fsPath)) {
                    dep.files.push(uri.fsPath);
                }
            } else {
                this.dependencies.set(module, {
                    module,
                    alias: value.alias,
                    files: [uri.fsPath]
                });
            }
        });
    }

    public getDependencies(): Dependency[] {
        return Array.from(this.dependencies.values());
    }

    public async generateRequirementsTxt(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        await this.scanWorkspace();
        const deps = this.getDependencies();

        if (deps.length === 0) {
            vscode.window.showInformationMessage('No Python dependencies found');
            return;
        }

        // Get unique modules
        const modules = Array.from(new Set(deps.map(d => d.module.split('.')[0])));
        const content = modules.join('\n') + '\n';

        const requirementsPath = path.join(workspaceFolder.uri.fsPath, 'requirements.txt');

        // Check if file exists and ask to overwrite
        if (fs.existsSync(requirementsPath)) {
            const answer = await vscode.window.showWarningMessage(
                'requirements.txt already exists. Overwrite?',
                'Yes', 'No'
            );

            if (answer !== 'Yes') {
                return;
            }
        }

        fs.writeFileSync(requirementsPath, content);
        
        // Open the file
        const doc = await vscode.workspace.openTextDocument(requirementsPath);
        await vscode.window.showTextDocument(doc);

        vscode.window.showInformationMessage(`Generated requirements.txt with ${modules.length} dependencies`);
    }

    public async showDependencyTree(): Promise<void> {
        await this.scanWorkspace();
        const deps = this.getDependencies();

        if (deps.length === 0) {
            vscode.window.showInformationMessage('No Python dependencies found');
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'frscriptDependencies',
            'Frscript Dependencies',
            vscode.ViewColumn.Beside,
            {}
        );

        const html = this.generateDependencyTreeHtml(deps);
        panel.webview.html = html;
    }

    private generateDependencyTreeHtml(deps: Dependency[]): string {
        const rows = deps.map(dep => {
            const fileList = dep.files
                .map(f => vscode.workspace.asRelativePath(f))
                .join('<br>');
            
            return `
                <tr>
                    <td><strong>${dep.module}</strong></td>
                    <td>${dep.alias || '-'}</td>
                    <td>${dep.files.length}</td>
                    <td><small>${fileList}</small></td>
                </tr>
            `;
        }).join('');

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-foreground);
                    }
                    h1 {
                        color: var(--vscode-textLink-foreground);
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin: 20px 0;
                    }
                    th, td {
                        padding: 12px;
                        text-align: left;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    th {
                        background: var(--vscode-editor-background);
                        font-weight: bold;
                    }
                    .summary {
                        background: var(--vscode-editor-background);
                        padding: 15px;
                        border-radius: 5px;
                        margin: 20px 0;
                    }
                </style>
            </head>
            <body>
                <h1>📦 Python Dependencies</h1>
                <div class="summary">
                    <p><strong>Total Dependencies:</strong> ${deps.length}</p>
                    <p><strong>Total Files:</strong> ${Array.from(new Set(deps.flatMap(d => d.files))).length}</p>
                </div>
                <table>
                    <tr>
                        <th>Module</th>
                        <th>Alias</th>
                        <th>Used In</th>
                        <th>Files</th>
                    </tr>
                    ${rows}
                </table>
            </body>
            </html>
        `;
    }

    public createCommands(): vscode.Disposable[] {
        return [
            vscode.commands.registerCommand('frscript.generateRequirementsTxt', async () => {
                await this.generateRequirementsTxt();
            }),

            vscode.commands.registerCommand('frscript.showDependencies', async () => {
                await this.showDependencyTree();
            }),

            vscode.commands.registerCommand('frscript.scanDependencies', async () => {
                await this.scanWorkspace();
                const deps = this.getDependencies();
                vscode.window.showInformationMessage(`Found ${deps.length} Python dependencies`);
            })
        ];
    }
}
