import * as vscode from 'vscode';
import { findFunctionBody } from './utils';

export class RefactoringProvider {
    
    public async extractFunction(
        document: vscode.TextDocument,
        selection: vscode.Selection
    ): Promise<vscode.WorkspaceEdit | null> {
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('Please select code to extract');
            return null;
        }

        // Get selected text
        const selectedText = document.getText(selection);
        const selectedLines = selectedText.split('\n');

        // Prompt for function name
        const functionName = await vscode.window.showInputBox({
            prompt: 'Enter name for extracted function',
            placeHolder: 'newFunction',
            validateInput: (value) => {
                if (!value || !/^[a-zA-Z_]\w*$/.test(value)) {
                    return 'Invalid function name';
                }
                return null;
            }
        });

        if (!functionName) {
            return null;
        }

        // Analyze variables used in selection
        const variables = this.extractVariables(selectedText);
        const returnValue = this.determineReturnValue(selectedText);

        // Build function signature
        let returnType = returnValue ? 'int' : 'void'; // Simplified for now
        const params = variables.map(v => `any ${v}`).join(', ');

        // Build new function
        let newFunction = `${returnType} ${functionName}(${params}) {\n`;
        selectedLines.forEach(line => {
            newFunction += `    ${line}\n`;
        });
        if (returnValue) {
            newFunction += `    return ${returnValue}\n`;
        }
        newFunction += '}\n\n';

        // Build function call
        const args = variables.join(', ');
        let functionCall: string;
        if (returnValue) {
            functionCall = `${returnType} result = ${functionName}(${args})`;
        } else {
            functionCall = `${functionName}(${args})`;
        }

        // Create edit
        const edit = new vscode.WorkspaceEdit();
        
        // Replace selection with function call
        edit.replace(document.uri, selection, functionCall);

        // Insert new function at the end of the file
        const lastLine = document.lineAt(document.lineCount - 1);
        const insertPosition = new vscode.Position(document.lineCount, 0);
        edit.insert(document.uri, insertPosition, '\n' + newFunction);

        return edit;
    }

    public async extractVariable(
        document: vscode.TextDocument,
        selection: vscode.Selection
    ): Promise<vscode.WorkspaceEdit | null> {
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('Please select an expression to extract');
            return null;
        }

        const selectedText = document.getText(selection).trim();

        // Prompt for variable name
        const varName = await vscode.window.showInputBox({
            prompt: 'Enter name for extracted variable',
            placeHolder: 'temp',
            validateInput: (value) => {
                if (!value || !/^[a-zA-Z_]\w*$/.test(value)) {
                    return 'Invalid variable name';
                }
                return null;
            }
        });

        if (!varName) {
            return null;
        }

        // Determine type (simplified)
        const varType = this.inferType(selectedText);

        // Create edit
        const edit = new vscode.WorkspaceEdit();

        // Insert variable declaration before current line
        const currentLine = selection.start.line;
        const lineText = document.lineAt(currentLine).text;
        const indent = lineText.match(/^\s*/)?.[0] || '';
        
        const declaration = `${indent}${varType} ${varName} = ${selectedText}\n`;
        const insertPosition = new vscode.Position(currentLine, 0);
        edit.insert(document.uri, insertPosition, declaration);

        // Replace selection with variable name
        edit.replace(document.uri, selection, varName);

        return edit;
    }

    public async inlineVariable(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.WorkspaceEdit | null> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const varName = document.getText(wordRange);
        const line = document.lineAt(position.line);
        const { text } = line;

        // Check if this line is a variable declaration
        const declMatch = text.match(new RegExp(`\\b(int|float|str|bool|list|dict|any)\\s+${varName}\\s*=\\s*(.+)$`));
        if (!declMatch) {
            vscode.window.showErrorMessage('Place cursor on a variable declaration to inline');
            return null;
        }

        const varValue = declMatch[2].trim();

        // Find all usages of this variable
        const edit = new vscode.WorkspaceEdit();
        const documentText = document.getText();
        const varRegex = new RegExp(`\\b${varName}\\b`, 'g');
        let match;
        let usageCount = 0;

        while ((match = varRegex.exec(documentText)) !== null) {
            const pos = document.positionAt(match.index);
            
            // Skip the declaration itself
            if (pos.line === position.line) {
                continue;
            }

            const range = new vscode.Range(pos, document.positionAt(match.index + varName.length));
            edit.replace(document.uri, range, varValue);
            usageCount++;
        }

        // Delete the declaration line
        const lineRange = new vscode.Range(
            new vscode.Position(position.line, 0),
            new vscode.Position(position.line + 1, 0)
        );
        edit.delete(document.uri, lineRange);

        if (usageCount === 0) {
            vscode.window.showWarningMessage('Variable is never used');
        }

        return edit;
    }

    public async convertToTypedParameters(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.WorkspaceEdit | null> {
        const line = document.lineAt(position.line);
        const { text } = line;

        // Match function with untyped parameters
        const funcMatch = text.match(/^\s*(void|int|float|str|bool|list|dict|any)\s+(\w+)\s*\(([^)]*)\)/);
        if (!funcMatch) {
            return null;
        }

        const returnType = funcMatch[1];
        const funcName = funcMatch[2];
        const params = funcMatch[3].trim();

        if (!params) {
            return null;
        }

        // Parse parameters
        const paramList = params.split(',').map(p => p.trim());
        const untypedParams: string[] = [];

        paramList.forEach(param => {
            // Check if already typed
            if (!param.match(/^(void|int|float|str|bool|list|dict|any|pyobject)\s+\w+$/)) {
                untypedParams.push(param);
            }
        });

        if (untypedParams.length === 0) {
            vscode.window.showInformationMessage('All parameters are already typed');
            return null;
        }

        // Prompt for types
        const typedParams: string[] = [];
        for (const param of paramList) {
            if (untypedParams.includes(param)) {
                const type = await vscode.window.showQuickPick(
                    ['int', 'float', 'str', 'bool', 'list', 'dict', 'any', 'pyobject'],
                    { placeHolder: `Select type for parameter '${param}'` }
                );
                
                if (!type) {
                    return null; // User cancelled
                }
                
                typedParams.push(`${type} ${param}`);
            } else {
                typedParams.push(param);
            }
        }

        // Build new signature
        const newSignature = `${returnType} ${funcName}(${typedParams.join(', ')})`;
        
        // Find the signature part in the line
        const signatureEnd = text.indexOf('(') + params.length + 2;
        const signatureRange = new vscode.Range(
            new vscode.Position(position.line, 0),
            new vscode.Position(position.line, signatureEnd)
        );

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, signatureRange, newSignature);

        return edit;
    }

    private extractVariables(code: string): string[] {
        const variables: Set<string> = new Set();
        const varRegex = /\b([a-zA-Z_]\w*)\b/g;
        let match;

        while ((match = varRegex.exec(code)) !== null) {
            const varName = match[1];
            
            // Skip keywords
            const keywords = ['if', 'else', 'while', 'for', 'return', 'true', 'false', 'int', 'float', 'str', 'bool', 'list', 'dict', 'any'];
            if (!keywords.includes(varName)) {
                variables.add(varName);
            }
        }

        return Array.from(variables);
    }

    private determineReturnValue(code: string): string | null {
        const returnMatch = code.match(/\breturn\s+(\w+)/);
        return returnMatch ? returnMatch[1] : null;
    }

    private inferType(expression: string): string {
        if (expression.match(/^".*"$/) || expression.match(/^'.*'$/)) {
            return 'str';
        }
        if (expression.match(/^\d+$/)) {
            return 'int';
        }
        if (expression.match(/^\d+\.\d+$/)) {
            return 'float';
        }
        if (expression === 'true' || expression === 'false') {
            return 'bool';
        }
        if (expression.match(/^\[.*\]$/)) {
            return 'list';
        }
        return 'any';
    }

    public createCommands(): vscode.Disposable[] {
        return [
            vscode.commands.registerCommand('frscript.extractFunction', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }

                const edit = await this.extractFunction(editor.document, editor.selection);
                if (edit) {
                    await vscode.workspace.applyEdit(edit);
                }
            }),

            vscode.commands.registerCommand('frscript.extractVariable', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }

                const edit = await this.extractVariable(editor.document, editor.selection);
                if (edit) {
                    await vscode.workspace.applyEdit(edit);
                }
            }),

            vscode.commands.registerCommand('frscript.inlineVariable', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }

                const edit = await this.inlineVariable(editor.document, editor.selection.active);
                if (edit) {
                    await vscode.workspace.applyEdit(edit);
                }
            }),

            vscode.commands.registerCommand('frscript.convertToTypedParameters', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }

                const edit = await this.convertToTypedParameters(editor.document, editor.selection.active);
                if (edit) {
                    await vscode.workspace.applyEdit(edit);
                }
            })
        ];
    }
}
