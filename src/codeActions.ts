import * as vscode from 'vscode';
import { PythonInteropProvider, createPythonImportCodeAction } from './pythonInterop';

export interface SymbolInfo {
    name: string;
    type: 'function' | 'struct' | 'variable';
    line: number;
    fields?: { name: string; type: string }[];
    parameters?: { name: string; type: string }[];
    returnType?: string;
}

export class EnhancedCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private pythonProvider: PythonInteropProvider) {}

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Handle diagnostics
        context.diagnostics.forEach(diagnostic => {
            actions.push(...this.createQuickFixesForDiagnostic(document, diagnostic));
        });

        // Add refactoring actions
        if (!range.isEmpty) {
            actions.push(...this.createRefactoringActions(document, range));
        }

        // Add source actions
        actions.push(...this.createSourceActions(document, range));

        return actions;
    }

    private createQuickFixesForDiagnostic(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Quick fix for deprecated print
        if (diagnostic.code === 'deprecated-print') {
            const fix = new vscode.CodeAction('Change to println', vscode.CodeActionKind.QuickFix);
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.replace(document.uri, diagnostic.range, 'println');
            fix.diagnostics = [diagnostic];
            fix.isPreferred = true;
            actions.push(fix);
        }

        // Quick fix for semicolons
        if (diagnostic.code === 'no-semicolons') {
            const fix = new vscode.CodeAction('Remove semicolon', vscode.CodeActionKind.QuickFix);
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.delete(document.uri, diagnostic.range);
            fix.diagnostics = [diagnostic];
            fix.isPreferred = true;
            actions.push(fix);
        }

        // Quick fix for missing return type
        if (diagnostic.message.includes('Missing return type')) {
            const line = document.lineAt(diagnostic.range.start.line);
            const { text } = line;
            const funcMatch = text.match(/^(\w+)\s*\(/);
            
            if (funcMatch) {
                const funcName = funcMatch[1];
                const fix = new vscode.CodeAction('Add void return type', vscode.CodeActionKind.QuickFix);
                fix.edit = new vscode.WorkspaceEdit();
                fix.edit.replace(document.uri, diagnostic.range, `void ${text.trim()}`);
                fix.diagnostics = [diagnostic];
                fix.isPreferred = true;
                actions.push(fix);
            }
        }

        // Quick fix for missing Python import
        if (diagnostic.code === 'missing-python-import') {
            const moduleName = diagnostic.message.match(/'([^']+)'/)?.[1];
            if (moduleName) {
                const fix = createPythonImportCodeAction(document, 'py_call', moduleName);
                fix.diagnostics = [diagnostic];
                fix.isPreferred = true;
                actions.push(fix);
            }
        }

        // Quick fix for unused variables/imports
        if (diagnostic.tags?.includes(vscode.DiagnosticTag.Unnecessary)) {
            const fix = new vscode.CodeAction('Remove unused code', vscode.CodeActionKind.QuickFix);
            fix.edit = new vscode.WorkspaceEdit();
            
            // Delete the entire line
            const lineRange = new vscode.Range(
                new vscode.Position(diagnostic.range.start.line, 0),
                new vscode.Position(diagnostic.range.start.line + 1, 0)
            );
            fix.edit.delete(document.uri, lineRange);
            fix.diagnostics = [diagnostic];
            actions.push(fix);
        }

        return actions;
    }

    private createRefactoringActions(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Extract function
        const extractFunction = new vscode.CodeAction(
            'Extract to function',
            vscode.CodeActionKind.RefactorExtract
        );
        extractFunction.command = {
            title: 'Extract Function',
            command: 'frscript.extractFunction'
        };
        actions.push(extractFunction);

        // Extract variable (only for single-line selections)
        if (range.start.line === range.end.line) {
            const extractVar = new vscode.CodeAction(
                'Extract to variable',
                vscode.CodeActionKind.RefactorExtract
            );
            extractVar.command = {
                title: 'Extract Variable',
                command: 'frscript.extractVariable'
            };
            actions.push(extractVar);
        }

        return actions;
    }

    private createSourceActions(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Generate documentation
        const line = document.lineAt(range.start.line);
        if (line.text.match(/^\s*(void|int|float|str|bool|list|dict|any)\s+\w+\s*\(/)) {
            const genDoc = new vscode.CodeAction(
                'Generate documentation',
                vscode.CodeActionKind.Source
            );
            genDoc.command = {
                title: 'Generate Documentation',
                command: 'frscript.generateDocumentation'
            };
            actions.push(genDoc);
        }

        // Organize imports
        const organizeImports = new vscode.CodeAction(
            'Organize imports',
            vscode.CodeActionKind.SourceOrganizeImports
        );
        organizeImports.command = {
            title: 'Organize Imports',
            command: 'frscript.organizeImports'
        };
        actions.push(organizeImports);

        // Sort members
        const sortMembers = new vscode.CodeAction(
            'Sort members',
            vscode.CodeActionKind.Source
        );
        sortMembers.command = {
            title: 'Sort Members',
            command: 'frscript.sortMembers'
        };
        actions.push(sortMembers);

        return actions;
    }
}

export function createOrganizeImportsCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('frscript.organizeImports', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'frscript') {
            return;
        }

        const { document } = editor;
        const imports: { line: number; text: string }[] = [];

        // Collect all imports
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            if (line.trim().startsWith('py_import') || line.trim().startsWith('from')) {
                imports.push({ line: i, text: line });
            }
        }

        if (imports.length === 0) {
            vscode.window.showInformationMessage('No imports to organize');
            return;
        }

        // Sort imports
        const sortedImports = imports
            .map(imp => imp.text.trim())
            .sort((a, b) => {
                // 'from' imports come before 'py_import'
                if (a.startsWith('from') && !b.startsWith('from')) {
                    return -1;
                }
                if (!a.startsWith('from') && b.startsWith('from')) {
                    return 1;
                }
                return a.localeCompare(b);
            });

        // Remove duplicates
        const uniqueImports = Array.from(new Set(sortedImports));

        // Create edit
        const edit = new vscode.WorkspaceEdit();

        // Delete old imports
        imports.forEach(imp => {
            const range = new vscode.Range(
                new vscode.Position(imp.line, 0),
                new vscode.Position(imp.line + 1, 0)
            );
            edit.delete(document.uri, range);
        });

        // Insert sorted imports at the top
        const newImports = uniqueImports.join('\n') + '\n\n';
        edit.insert(document.uri, new vscode.Position(0, 0), newImports);

        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage('Imports organized');
    });
}

export function createSortMembersCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('frscript.sortMembers', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'frscript') {
            return;
        }

        vscode.window.showInformationMessage('Sort members feature coming soon!');
    });
}

export function createAddTypeAnnotationAction(
    document: vscode.TextDocument,
    position: vscode.Position,
    varName: string
): vscode.CodeAction {
    const action = new vscode.CodeAction(
        `Add type annotation to '${varName}'`,
        vscode.CodeActionKind.QuickFix
    );

    const line = document.lineAt(position.line);
    const { text } = line;
    
    // Simple type inference
    const valueMatch = text.match(new RegExp(`${varName}\\s*=\\s*(.+)$`));
    let suggestedType = 'any';
    
    if (valueMatch) {
        const value = valueMatch[1].trim();
        if (value.match(/^["'].*["']$/)) {
            suggestedType = 'str';
        } else if (value.match(/^\d+$/)) {
            suggestedType = 'int';
        } else if (value.match(/^\d+\.\d+$/)) {
            suggestedType = 'float';
        } else if (value === 'true' || value === 'false') {
            suggestedType = 'bool';
        } else if (value.startsWith('[')) {
            suggestedType = 'list';
        }
    }

    const edit = new vscode.WorkspaceEdit();
    const varPos = text.indexOf(varName);
    edit.insert(document.uri, new vscode.Position(position.line, varPos), `${suggestedType} `);
    action.edit = edit;

    return action;
}
