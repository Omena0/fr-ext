import * as vscode from 'vscode';
import { getConfig } from './utils';

export interface DocstringTemplate {
    summary: string;
    params: { name: string; type: string; description: string }[];
    returns: { type: string; description: string } | null;
    examples: string[];
}

export class DocumentationProvider {
    
    public generateDocstring(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.WorkspaceEdit | null {
        const line = document.lineAt(position.line);
        const { text } = line;

        // Check if this is a function declaration
        const funcMatch = text.match(/^\s*(void|int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj|function)\s+(\w+)\s*\(([^)]*)\)/);
        if (!funcMatch) {
            return null;
        }

        const returnType = funcMatch[1];
        const functionName = funcMatch[2];
        const paramsText = funcMatch[3].trim();

        // Parse parameters
        const params: { name: string; type: string }[] = [];
        if (paramsText) {
            const paramList = paramsText.split(',');
            paramList.forEach(param => {
                const trimmed = param.trim();
                const typedMatch = trimmed.match(/^(void|int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj|function)\s+(\w+)$/);
                if (typedMatch) {
                    params.push({ type: typedMatch[1], name: typedMatch[2] });
                } else {
                    const untypedMatch = trimmed.match(/^(\w+)$/);
                    if (untypedMatch) {
                        params.push({ type: 'any', name: untypedMatch[1] });
                    }
                }
            });
        }

        // Generate docstring
        const config = getConfig();
        let docstring = '/// ';
        
        // Summary
        docstring += `${this.generateSummary(functionName)}\n`;
        
        // Parameters
        if (params.length > 0) {
            docstring += '///\n';
            params.forEach(param => {
                docstring += `/// @param ${param.name} - Description of ${param.name} (${param.type})\n`;
            });
        }

        // Return value
        if (returnType !== 'void') {
            docstring += '///\n';
            docstring += `/// @returns ${returnType} - Description of return value\n`;
        }

        // Examples (if enabled)
        if (config.documentation.includeExamples) {
            docstring += '///\n';
            docstring += '/// @example\n';
            docstring += `/// ${this.generateExample(functionName, params)}\n`;
        }

        // Create edit
        const edit = new vscode.WorkspaceEdit();
        const insertPosition = new vscode.Position(position.line, 0);
        edit.insert(document.uri, insertPosition, docstring);

        return edit;
    }

    private generateSummary(functionName: string): string {
        // Convert camelCase or snake_case to readable text
        const words = functionName
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .trim()
            .toLowerCase();
        
        return words.charAt(0).toUpperCase() + words.slice(1);
    }

    private generateExample(functionName: string, params: { name: string; type: string }[]): string {
        const args = params.map(p => {
            switch (p.type) {
                case 'int': return '0';
                case 'float': return '0.0';
                case 'str': case 'string': return '"example"';
                case 'bool': return 'true';
                case 'list': return '[]';
                case 'dict': return '{}';
                default: return 'value';
            }
        }).join(', ');

        return `${functionName}(${args})`;
    }

    public enhanceHoverWithMarkdown(
        documentation: string,
        signature?: string
    ): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        if (signature) {
            markdown.appendCodeblock(signature, 'frscript');
            markdown.appendMarkdown('\n\n---\n\n');
        }

        // Parse custom documentation tags
        const lines = documentation.split('\n');
        let inExample = false;
        let exampleCode = '';

        lines.forEach(line => {
            const trimmed = line.trim();

            if (trimmed.startsWith('@param')) {
                const paramMatch = trimmed.match(/@param\s+(\w+)\s+-\s+(.+)/);
                if (paramMatch) {
                    markdown.appendMarkdown(`**${paramMatch[1]}**: ${paramMatch[2]}\n\n`);
                }
            } else if (trimmed.startsWith('@returns')) {
                const returnMatch = trimmed.match(/@returns\s+(\w+)\s+-\s+(.+)/);
                if (returnMatch) {
                    markdown.appendMarkdown(`**Returns** (${returnMatch[1]}): ${returnMatch[2]}\n\n`);
                }
            } else if (trimmed.startsWith('@example')) {
                inExample = true;
                markdown.appendMarkdown('**Example:**\n\n');
            } else if (inExample) {
                if (trimmed && !trimmed.startsWith('@')) {
                    exampleCode += trimmed + '\n';
                } else {
                    if (exampleCode) {
                        markdown.appendCodeblock(exampleCode.trim(), 'frscript');
                        exampleCode = '';
                    }
                    inExample = false;
                }
            } else if (trimmed && !trimmed.startsWith('@')) {
                markdown.appendMarkdown(trimmed + '\n\n');
            }
        });

        if (exampleCode) {
            markdown.appendCodeblock(exampleCode.trim(), 'frscript');
        }

        return markdown;
    }

    public createGenerateDocCommand(): vscode.Disposable {
        return vscode.commands.registerCommand('frscript.generateDocumentation', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'frscript') {
                vscode.window.showErrorMessage('No active Frscript file');
                return;
            }

            const position = editor.selection.active;
            const edit = this.generateDocstring(editor.document, position);

            if (edit) {
                await vscode.workspace.applyEdit(edit);
                vscode.window.showInformationMessage('Documentation generated!');
            } else {
                vscode.window.showErrorMessage('Place cursor on a function declaration to generate documentation');
            }
        });
    }

    public createGenerateAllDocsCommand(): vscode.Disposable {
        return vscode.commands.registerCommand('frscript.generateAllDocumentation', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'frscript') {
                vscode.window.showErrorMessage('No active Frscript file');
                return;
            }

            const {document} = editor;
            const edit = new vscode.WorkspaceEdit();
            let count = 0;

            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                const { text } = line;

                // Check if function already has documentation
                const hasDoc = i > 0 && document.lineAt(i - 1).text.trim().startsWith('///');
                
                if (!hasDoc && text.match(/^\s*(void|int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj|function)\s+\w+\s*\(/)) {
                    const funcEdit = this.generateDocstring(document, new vscode.Position(i, 0));
                    if (funcEdit) {
                        // Merge edits
                        funcEdit.entries().forEach(([uri, edits]) => {
                            edits.forEach(e => {
                                edit.insert(uri, e.range.start, e.newText);
                            });
                        });
                        count++;
                    }
                }
            }

            if (count > 0) {
                await vscode.workspace.applyEdit(edit);
                vscode.window.showInformationMessage(`Generated documentation for ${count} function(s)!`);
            } else {
                vscode.window.showInformationMessage('No undocumented functions found');
            }
        });
    }

    public createCommands(): vscode.Disposable[] {
        return [
            this.createGenerateDocCommand(),
            this.createGenerateAllDocsCommand()
        ];
    }
}
