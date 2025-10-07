import * as vscode from 'vscode';
import { getConfig, createIndent } from './utils';

export class EnhancedFormattingProvider implements vscode.DocumentFormattingEditProvider {
    public provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];
        const config = getConfig();
        let indentLevel = 0;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const { text } = line;
            const trimmed = text.trim();

            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('//')) {
                continue;
            }

            // Decrease indent for closing braces and case/default
            if (trimmed.startsWith('}') || trimmed.startsWith('case ') || trimmed === 'default:') {
                indentLevel = Math.max(0, indentLevel - 1);
            }

            // Special handling for else/elif
            if (trimmed.startsWith('else') || trimmed.startsWith('elif')) {
                // Same level as the if
                const properIndent = createIndent(indentLevel, config.formatting.insertSpaces, config.formatting.indentSize);
                const formatted = properIndent + trimmed;

                if (formatted !== text) {
                    const range = new vscode.Range(
                        new vscode.Position(i, 0),
                        new vscode.Position(i, text.length)
                    );
                    edits.push(vscode.TextEdit.replace(range, formatted));
                }
                continue;
            }

            // Calculate proper indentation
            const properIndent = createIndent(indentLevel, config.formatting.insertSpaces, config.formatting.indentSize);
            const formatted = properIndent + trimmed;

            if (formatted !== text) {
                const range = new vscode.Range(
                    new vscode.Position(i, 0),
                    new vscode.Position(i, text.length)
                );
                edits.push(vscode.TextEdit.replace(range, formatted));
            }

            // Increase indent for opening braces and case statements
            if (trimmed.endsWith('{')) {
                indentLevel++;
            } else if (trimmed.startsWith('case ') || trimmed === 'default:') {
                indentLevel++;
            }
        }

        return edits;
    }
}

export class RangeFormattingProvider implements vscode.DocumentRangeFormattingEditProvider {
    public provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];
        const config = getConfig();

        // Determine starting indent level
        let indentLevel = 0;
        if (range.start.line > 0) {
            const prevLine = document.lineAt(range.start.line - 1).text;
            const openBraces = (prevLine.match(/{/g) || []).length;
            const closeBraces = (prevLine.match(/}/g) || []).length;
            indentLevel = Math.max(0, openBraces - closeBraces);
        }

        for (let i = range.start.line; i <= range.end.line; i++) {
            const line = document.lineAt(i);
            const { text } = line;
            const trimmed = text.trim();

            if (!trimmed || trimmed.startsWith('//')) {
                continue;
            }

            if (trimmed.startsWith('}')) {
                indentLevel = Math.max(0, indentLevel - 1);
            }

            const properIndent = createIndent(indentLevel, config.formatting.insertSpaces, config.formatting.indentSize);
            const formatted = properIndent + trimmed;

            if (formatted !== text) {
                const lineRange = new vscode.Range(
                    new vscode.Position(i, 0),
                    new vscode.Position(i, text.length)
                );
                edits.push(vscode.TextEdit.replace(lineRange, formatted));
            }

            if (trimmed.endsWith('{')) {
                indentLevel++;
            }
        }

        return edits;
    }
}

export class OnTypeFormattingProvider implements vscode.OnTypeFormattingEditProvider {
    public provideOnTypeFormattingEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        ch: string
    ): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];

        // Auto-indent after opening brace
        if (ch === '{') {
            const line = document.lineAt(position.line);
            const { text } = line;
            const config = getConfig();
            
            // Add newline and indent
            const currentIndent = text.match(/^\s*/)?.[0] || '';
            const newIndent = currentIndent + createIndent(1, config.formatting.insertSpaces, config.formatting.indentSize);
            
            const edit = vscode.TextEdit.insert(
                new vscode.Position(position.line + 1, 0),
                newIndent
            );
            edits.push(edit);
        }

        // Auto-close braces
        if (ch === '\n') {
            const line = document.lineAt(position.line - 1);
            const { text } = line;
            
            if (text.trim().endsWith('{')) {
                const config = getConfig();
                const currentIndent = text.match(/^\s*/)?.[0] || '';
                const closeBrace = currentIndent + '}';
                
                const edit = vscode.TextEdit.insert(
                    new vscode.Position(position.line + 1, 0),
                    closeBrace + '\n'
                );
                edits.push(edit);
            }
        }

        return edits;
    }
}

export function registerFormattingProviders(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            'frscript',
            new EnhancedFormattingProvider()
        ),
        vscode.languages.registerDocumentRangeFormattingEditProvider(
            'frscript',
            new RangeFormattingProvider()
        ),
        vscode.languages.registerOnTypeFormattingEditProvider(
            'frscript',
            new OnTypeFormattingProvider(),
            '{', '\n', '}'
        )
    );
}
