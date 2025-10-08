import * as vscode from 'vscode';

export interface WorkspaceSymbol {
    name: string;
    type: 'function' | 'struct' | 'variable';
    uri: vscode.Uri;
    line: number;
    containerName?: string;
}

export class WorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    private symbolCache: Map<string, WorkspaceSymbol[]> = new Map();

    public async provideWorkspaceSymbols(
        query: string,
        token: vscode.CancellationToken
    ): Promise<vscode.SymbolInformation[]> {
        const symbols: vscode.SymbolInformation[] = [];
        
        // Find all .fr files in workspace
        const files = await vscode.workspace.findFiles('**/*.fr', '**/node_modules/**');

        for (const file of files) {
            if (token.isCancellationRequested) {
                break;
            }

            const fileSymbols = await this.getFileSymbols(file);
            
            fileSymbols
                .filter(symbol => this.matchesQuery(symbol.name, query))
                .forEach(symbol => {
                    const kind = this.getSymbolKind(symbol.type);
                    const location = new vscode.Location(
                        symbol.uri,
                        new vscode.Position(symbol.line, 0)
                    );

                    symbols.push(
                        new vscode.SymbolInformation(
                            symbol.name,
                            kind,
                            symbol.containerName || '',
                            location
                        )
                    );
                });
        }

        return symbols;
    }

    private async getFileSymbols(uri: vscode.Uri): Promise<WorkspaceSymbol[]> {
        const cacheKey = uri.toString();
        
        if (this.symbolCache.has(cacheKey)) {
            return this.symbolCache.get(cacheKey)!;
        }

        const symbols: WorkspaceSymbol[] = [];
        const document = await vscode.workspace.openTextDocument(uri);

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const { text } = line;

            // Match function declarations
            const funcMatch = text.match(/^\s*(void|int|float|str|bool|list|dict|any|pyobject)\s+(\w+)\s*\(/);
            if (funcMatch) {
                symbols.push({
                    name: funcMatch[2],
                    type: 'function',
                    uri,
                    line: i
                });
            }

            // Match struct declarations
            const structMatch = text.match(/^\s*struct\s+(\w+)\s*\{/);
            if (structMatch) {
                symbols.push({
                    name: structMatch[1],
                    type: 'struct',
                    uri,
                    line: i
                });
            }

            // Match variable declarations
            const varMatch = text.match(/^\s*(int|float|str|bool|list|dict|any|pyobject)\s+(\w+)\s*=/);
            if (varMatch) {
                symbols.push({
                    name: varMatch[2],
                    type: 'variable',
                    uri,
                    line: i
                });
            }
        }

        this.symbolCache.set(cacheKey, symbols);
        return symbols;
    }

    private matchesQuery(name: string, query: string): boolean {
        if (!query) {
            return true;
        }

        const lowerName = name.toLowerCase();
        const lowerQuery = query.toLowerCase();

        // Exact match
        if (lowerName === lowerQuery) {
            return true;
        }

        // Starts with
        if (lowerName.startsWith(lowerQuery)) {
            return true;
        }

        // Contains
        if (lowerName.includes(lowerQuery)) {
            return true;
        }

        // Camel case match (e.g., "gUD" matches "getUserData")
        const camelPattern = query.split('').join('.*');
        const regex = new RegExp(camelPattern, 'i');
        if (regex.test(name)) {
            return true;
        }

        return false;
    }

    private getSymbolKind(type: string): vscode.SymbolKind {
        switch (type) {
            case 'function': return vscode.SymbolKind.Function;
            case 'struct': return vscode.SymbolKind.Struct;
            case 'variable': return vscode.SymbolKind.Variable;
            default: return vscode.SymbolKind.Null;
        }
    }

    public clearCache(uri?: vscode.Uri) {
        if (uri) {
            this.symbolCache.delete(uri.toString());
        } else {
            this.symbolCache.clear();
        }
    }
}

export function registerWorkspaceSymbolProvider(context: vscode.ExtensionContext): void {
    const provider = new WorkspaceSymbolProvider();

    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider(provider)
    );

    // Clear cache when files change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'frscript') {
                provider.clearCache(e.document.uri);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles(e => {
            e.files.forEach(uri => provider.clearCache(uri));
        })
    );
}

export function createFindSymbolCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('frscript.findSymbol', async () => {
        const symbol = await vscode.window.showInputBox({
            prompt: 'Enter symbol name to find',
            placeHolder: 'Symbol name'
        });

        if (!symbol) {
            return;
        }

        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            symbol
        );

        if (!symbols || symbols.length === 0) {
            vscode.window.showInformationMessage(`No symbols found matching '${symbol}'`);
            return;
        }

        if (symbols.length === 1) {
            // Jump directly
            const {location} = symbols[0];
            await vscode.window.showTextDocument(location.uri, {
                selection: location.range
            });
        } else {
            // Show quick pick
            const items = symbols.map(s => ({
                label: s.name,
                description: s.containerName || vscode.workspace.asRelativePath(s.location.uri),
                detail: vscode.SymbolKind[s.kind],
                symbol: s
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select symbol'
            });

            if (selected) {
                const {location} = selected.symbol;
                await vscode.window.showTextDocument(location.uri, {
                    selection: location.range
                });
            }
        }
    });
}
