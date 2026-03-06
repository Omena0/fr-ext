import * as vscode from 'vscode';
import { extractPythonImports } from './utils';

export interface PythonModule {
    name: string;
    alias?: string;
    members?: string[];
    line: number;
}

export class PythonInteropProvider {
    private importCache: Map<string, PythonModule[]> = new Map();

    public getImports(document: vscode.TextDocument): PythonModule[] {
        const cacheKey = document.uri.toString();
        
        if (this.importCache.has(cacheKey)) {
            return this.importCache.get(cacheKey)!;
        }

        const imports: PythonModule[] = [];
        const importMap = extractPythonImports(document);

        importMap.forEach((value, key) => {
            imports.push({
                name: value.module,
                alias: value.alias,
                line: value.line,
            });
        });

        this.importCache.set(cacheKey, imports);
        return imports;
    }

    public clearCache(document: vscode.TextDocument) {
        this.importCache.delete(document.uri.toString());
    }

    public providePythonCompletions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];
        const imports = this.getImports(document);

        // Get text before cursor to determine context
        const lineText = document.lineAt(position.line).text;
        const textBefore = lineText.substring(0, position.character);

        // Check if we're in a py_call context
        const pyCallMatch = textBefore.match(/py_call\s*\(\s*"([^"]*)"?\s*,?\s*"?$/);
        if (pyCallMatch) {
            const modulePrefix = pyCallMatch[1];
            
            // Suggest imported modules
            imports.forEach(imp => {
                if (imp.name.startsWith(modulePrefix)) {
                    const item = new vscode.CompletionItem(imp.name, vscode.CompletionItemKind.Module);
                    item.detail = 'Python module';
                    item.insertText = imp.name;
                    completions.push(item);
                }
            });
        }

        return completions;
    }

    public validateImport(moduleName: string): boolean {
        // In a real implementation, this would check if the Python module exists
        // For now, we'll return true for common modules
        const commonModules = [
            'os', 'sys', 'json', 'math', 'random', 'datetime', 'time',
            'requests', 'numpy', 'pandas', 'flask', 'django', 'asyncio'
        ];
        
        return commonModules.includes(moduleName);
    }

    public suggestImportForFunction(functionName: string): string[] {
        // Map of function names to their modules
        const functionModuleMap: Record<string, string[]> = {
            'randint': ['random'],
            'choice': ['random'],
            'sleep': ['time'],
            'get': ['requests'],
            'post': ['requests'],
            'loads': ['json'],
            'dumps': ['json'],
            'sqrt': ['math'],
            'sin': ['math'],
            'cos': ['math'],
        };

        return functionModuleMap[functionName] || [];
    }

    /**
     * Find the Python executable to use (prefers .venv)
     */
    private findPythonCommand(): string {
        const path = require('path');
        const fs = require('fs');
        const vscode = require('vscode');
        
        let pythonCommand = 'python3';
        
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const venvPath = path.join(workspaceRoot, '.venv');
            
            if (fs.existsSync(venvPath)) {
                pythonCommand = process.platform === 'win32' ? 
                    path.join(venvPath, 'Scripts', 'python.exe') :
                    path.join(venvPath, 'bin', 'python');
            }
        }
        
        return pythonCommand;
    }

    /**
     * Run a Python script with arguments and return stdout, with timeout and fallback
     */
    private runPythonScript(script: string, args: string[], timeoutMs: number = 2000): Promise<string | null> {
        const { spawn } = require('child_process');
        const pythonCommand = this.findPythonCommand();

        return new Promise((resolve) => {
            // Pass arguments safely via sys.argv, not string interpolation
            const python = spawn(pythonCommand, ['-c', script, ...args]);
            let output = '';

            python.stdout.on('data', (data: Buffer) => {
                output += data.toString();
            });

            python.on('close', (code: number) => {
                if (code === 0 && output.trim()) {
                    resolve(output.trim());
                } else if (pythonCommand.includes('.venv')) {
                    // Fallback to system python3
                    const pythonFallback = spawn('python3', ['-c', script, ...args]);
                    let fallbackOutput = '';
                    
                    pythonFallback.stdout.on('data', (data: Buffer) => {
                        fallbackOutput += data.toString();
                    });
                    
                    pythonFallback.on('close', (fallbackCode: number) => {
                        if (fallbackCode === 0 && fallbackOutput.trim()) {
                            resolve(fallbackOutput.trim());
                        } else {
                            resolve(null);
                        }
                    });
                    
                    setTimeout(() => {
                        pythonFallback.kill();
                        resolve(null);
                    }, timeoutMs);
                } else {
                    resolve(null);
                }
            });

            setTimeout(() => {
                python.kill();
                resolve(null);
            }, timeoutMs);
        });
    }

    /**
     * Get Python object signature by introspecting the actual Python module
     */
    public async getPythonSignature(moduleName: string, objectName: string): Promise<string | null> {
        try {
            // Arguments passed via sys.argv to prevent code injection
            const pythonScript = `
import sys
import os

os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'
os.environ['SDL_AUDIODRIVER'] = 'dummy'
os.environ['SDL_VIDEODRIVER'] = 'dummy'

import io
old_stdout = sys.stdout
sys.stdout = io.StringIO()

try:
    import inspect
    module_name = sys.argv[1]
    object_name = sys.argv[2]
    module = __import__(module_name)
    obj = getattr(module, object_name)
    
    sys.stdout = old_stdout
    
    try:
        sig = inspect.signature(obj)
        print(f"{object_name}{sig}")
    except Exception:
        obj_type = type(obj).__name__
        print(f"{object_name}: {obj_type}")
        
    doc = inspect.getdoc(obj)
    if doc:
        first_line = doc.split('\\n')[0]
        print(f"DOC:{first_line}")
except Exception as e:
    sys.stdout = old_stdout
    pass
`;

            return await this.runPythonScript(pythonScript, [moduleName, objectName]);
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all public members of a Python module
     */
    public async getModuleMembers(moduleName: string): Promise<Array<{name: string, type: string, signature?: string, doc?: string}> | null> {
        try {
            const pythonScript = `
import sys
import os
import json

os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'
os.environ['SDL_AUDIODRIVER'] = 'dummy'
os.environ['SDL_VIDEODRIVER'] = 'dummy'

import io
old_stdout = sys.stdout
sys.stdout = io.StringIO()

try:
    import inspect
    module_name = sys.argv[1]
    module = __import__(module_name)
    
    sys.stdout = old_stdout
    
    members = []
    for name in dir(module):
        if name.startswith('_'):
            continue
        
        try:
            obj = getattr(module, name)
            member = {'name': name}
            
            if inspect.isclass(obj):
                member['type'] = 'class'
                try:
                    sig = inspect.signature(obj)
                    member['signature'] = f"{name}{sig}"
                except:
                    member['signature'] = name
            elif inspect.isfunction(obj) or inspect.ismethod(obj):
                member['type'] = 'function'
                try:
                    sig = inspect.signature(obj)
                    member['signature'] = f"{name}{sig}"
                except:
                    member['signature'] = name
            else:
                member['type'] = 'variable'
                member['signature'] = f"{name}: {type(obj).__name__}"
            
            doc = inspect.getdoc(obj)
            if doc:
                member['doc'] = doc.split('\\n')[0]
            
            members.append(member)
        except:
            pass
    
    print(json.dumps(members))
except Exception as e:
    sys.stdout = old_stdout
    pass
`;

            const result = await this.runPythonScript(pythonScript, [moduleName]);
            if (result) {
                try {
                    return JSON.parse(result);
                } catch {
                    return null;
                }
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all public members of a Python class
     */
    public async getClassMembers(moduleName: string, className: string): Promise<Array<{name: string, type: string, signature?: string, doc?: string}> | null> {
        try {
            const pythonScript = `
import sys
import os
import json

os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'
os.environ['SDL_AUDIODRIVER'] = 'dummy'
os.environ['SDL_VIDEODRIVER'] = 'dummy'

import io
old_stdout = sys.stdout
sys.stdout = io.StringIO()

try:
    import inspect
    module_name = sys.argv[1]
    class_name = sys.argv[2]
    module = __import__(module_name)
    
    sys.stdout = old_stdout
    
    cls = getattr(module, class_name)
    members = []
    
    for name in dir(cls):
        if name.startswith('_'):
            continue
        
        try:
            obj = getattr(cls, name)
            member = {'name': name}
            
            if inspect.ismethod(obj) or inspect.isfunction(obj):
                member['type'] = 'method'
                try:
                    sig = inspect.signature(obj)
                    member['signature'] = f"{name}{sig}"
                except:
                    member['signature'] = name
            else:
                member['type'] = 'property'
                member['signature'] = f"{name}"
            
            doc = inspect.getdoc(obj)
            if doc:
                member['doc'] = doc.split('\\n')[0]
            
            members.append(member)
        except:
            pass
    
    print(json.dumps(members))
except Exception as e:
    sys.stdout = old_stdout
    pass
`;

            const result = await this.runPythonScript(pythonScript, [moduleName, className]);
            if (result) {
                try {
                    return JSON.parse(result);
                } catch {
                    return null;
                }
            }
            return null;
        } catch (error) {
            return null;
        }
    }
}

export function createPythonImportCodeAction(
    document: vscode.TextDocument,
    functionName: string,
    moduleName: string
): vscode.CodeAction {
    const action = new vscode.CodeAction(
        `Import ${moduleName} for ${functionName}`,
        vscode.CodeActionKind.QuickFix
    );

    const edit = new vscode.WorkspaceEdit();
    
    // Find the best place to insert the import (after other imports or at the top)
    let insertLine = 0;
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();
        if (line.startsWith('py_import') || line.startsWith('from')) {
            insertLine = i + 1;
        } else if (line && !line.startsWith('//')) {
            break;
        }
    }

    const insertPosition = new vscode.Position(insertLine, 0);
    const importStatement = `py_import ${moduleName}\n`;
    
    edit.insert(document.uri, insertPosition, importStatement);
    action.edit = edit;

    return action;
}

export function createPythonInteropDiagnostics(
    document: vscode.TextDocument,
    pythonProvider: PythonInteropProvider
): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const imports = pythonProvider.getImports(document);
    const importedModules = new Set(imports.map(imp => imp.alias || imp.name));

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const {text} = line;

        // Check for py_call with potentially undefined modules
        const pyCallMatch = text.match(/py_call\s*\(\s*"([^"]+)"/);
        if (pyCallMatch) {
            const moduleName = pyCallMatch[1];
            
            if (!importedModules.has(moduleName) && !pythonProvider.validateImport(moduleName)) {
                const start = text.indexOf(moduleName);
                const range = new vscode.Range(i, start, i, start + moduleName.length);
                
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Module '${moduleName}' is not imported. Add 'py_import ${moduleName}'.`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.code = 'missing-python-import';
                diagnostics.push(diagnostic);
            }
        }

        // Check for unused imports
        imports.forEach(imp => {
            if (imp.line === i) {
                const moduleName = imp.alias || imp.name;
                const usageRegex = new RegExp(`\\b${moduleName}\\b`, 'g');
                const documentText = document.getText();
                const uses = documentText.match(usageRegex) || [];
                
                // Subtract 1 for the import declaration itself
                if (uses.length <= 1) {
                    const {range} = line;
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Python import '${moduleName}' is never used`,
                        vscode.DiagnosticSeverity.Hint
                    );
                    diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
                    diagnostic.code = 'unused-python-import';
                    diagnostics.push(diagnostic);
                }
            }
        });
    }

    return diagnostics;
}
