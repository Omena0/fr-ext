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
     * Get Python object signature by introspecting the actual Python module
     */
    public async getPythonSignature(moduleName: string, objectName: string): Promise<string | null> {
        try {
            const { spawn } = require('child_process');
            const path = require('path');
            const fs = require('fs');
            
            // Determine Python executable to use
            let pythonCommand = 'python3';
            
            // Check if .venv exists in workspace and use it
            const vscode = require('vscode');
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const venvPath = path.join(workspaceRoot, '.venv');
                
                if (fs.existsSync(venvPath)) {
                    // Use .venv Python
                    pythonCommand = process.platform === 'win32' ? 
                        path.join(venvPath, 'Scripts', 'python.exe') :
                        path.join(venvPath, 'bin', 'python');
                }
            }
            
            // Python script to introspect the module
            const pythonScript = `
import sys
import os

# Suppress pygame and other library messages
os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'
os.environ['SDL_AUDIODRIVER'] = 'dummy'
os.environ['SDL_VIDEODRIVER'] = 'dummy'

# Redirect stdout temporarily to suppress import messages
import io
old_stdout = sys.stdout
sys.stdout = io.StringIO()

try:
    import inspect
    module = __import__('${moduleName}')
    obj = getattr(module, '${objectName}')
    
    # Restore stdout
    sys.stdout = old_stdout
    
    # Get signature
    try:
        sig = inspect.signature(obj)
        print(f"${objectName}{sig}")
    except Exception as sig_err:
        # For objects without signature, just show the type
        obj_type = type(obj).__name__
        print(f"${objectName}: {obj_type}")
        
    # Get docstring if available
    doc = inspect.getdoc(obj)
    if doc:
        # Get first line of docstring
        first_line = doc.split('\\n')[0]
        print(f"DOC:{first_line}")
except Exception as e:
    sys.stdout = old_stdout
    # Don't print errors, just exit cleanly
    pass
`;

            return new Promise((resolve) => {
                const python = spawn(pythonCommand, ['-c', pythonScript]);
                let output = '';
                let error = '';

                python.stdout.on('data', (data: Buffer) => {
                    output += data.toString();
                });

                python.stderr.on('data', (data: Buffer) => {
                    error += data.toString();
                });

                python.on('close', (code: number) => {
                    if (code === 0 && output.trim()) {
                                            resolve(output.trim());
                                        }
                    else if (pythonCommand.includes('.venv')) {
                                                const pythonFallback = spawn('python3', ['-c', pythonScript]);
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
                                                }, 2000);
                                            }
                    else {
                                                resolve(null);
                                            }
                });

                // Timeout after 2 seconds
                setTimeout(() => {
                    python.kill();
                    resolve(null);
                }, 2000);
            });
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all public members of a Python module
     */
    public async getModuleMembers(moduleName: string): Promise<Array<{name: string, type: string, signature?: string, doc?: string}> | null> {
        try {
            const { spawn } = require('child_process');
            const path = require('path');
            const fs = require('fs');
            
            // Determine Python executable to use
            let pythonCommand = 'python3';
            
            // Check if .venv exists in workspace and use it
            const vscode = require('vscode');
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const venvPath = path.join(workspaceRoot, '.venv');
                
                if (fs.existsSync(venvPath)) {
                    // Use .venv Python
                    pythonCommand = process.platform === 'win32' ? 
                        path.join(venvPath, 'Scripts', 'python.exe') :
                        path.join(venvPath, 'bin', 'python');
                }
            }
            
            // Python script to get module members
            const pythonScript = `
import sys
import os
import json

# Suppress pygame and other library messages
os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'
os.environ['SDL_AUDIODRIVER'] = 'dummy'
os.environ['SDL_VIDEODRIVER'] = 'dummy'

# Redirect stdout temporarily to suppress import messages
import io
old_stdout = sys.stdout
sys.stdout = io.StringIO()

try:
    import inspect
    module = __import__('${moduleName}')
    
    # Restore stdout
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
            
            # Get first line of docstring
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

            return new Promise((resolve) => {
                const python = spawn(pythonCommand, ['-c', pythonScript]);
                let output = '';

                python.stdout.on('data', (data: Buffer) => {
                    output += data.toString();
                });

                python.on('close', (code: number) => {
                    if (code === 0 && output.trim()) {
                        try {
                            const members = JSON.parse(output.trim());
                            resolve(members);
                        } catch {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                });

                // Timeout after 2 seconds
                setTimeout(() => {
                    python.kill();
                    resolve(null);
                }, 2000);
            });
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all public members of a Python class
     */
    public async getClassMembers(moduleName: string, className: string): Promise<Array<{name: string, type: string, signature?: string, doc?: string}> | null> {
        try {
            const { spawn } = require('child_process');
            const path = require('path');
            const fs = require('fs');
            
            // Determine Python executable to use
            let pythonCommand = 'python3';
            
            // Check if .venv exists in workspace and use it
            const vscode = require('vscode');
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const venvPath = path.join(workspaceRoot, '.venv');
                
                if (fs.existsSync(venvPath)) {
                    // Use .venv Python
                    pythonCommand = process.platform === 'win32' ? 
                        path.join(venvPath, 'Scripts', 'python.exe') :
                        path.join(venvPath, 'bin', 'python');
                }
            }
            
            // Python script to get class members
            const pythonScript = `
import sys
import os
import json

# Suppress pygame and other library messages
os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'
os.environ['SDL_AUDIODRIVER'] = 'dummy'
os.environ['SDL_VIDEODRIVER'] = 'dummy'

# Redirect stdout temporarily to suppress import messages
import io
old_stdout = sys.stdout
sys.stdout = io.StringIO()

try:
    import inspect
    module = __import__('${moduleName}')
    
    # Restore stdout
    sys.stdout = old_stdout
    
    cls = getattr(module, '${className}')
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
            
            # Get first line of docstring
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

            return new Promise((resolve) => {
                const python = spawn(pythonCommand, ['-c', pythonScript]);
                let output = '';

                python.stdout.on('data', (data: Buffer) => {
                    output += data.toString();
                });

                python.on('close', (code: number) => {
                    if (code === 0 && output.trim()) {
                        try {
                            const members = JSON.parse(output.trim());
                            resolve(members);
                        } catch {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                });

                // Timeout after 2 seconds
                setTimeout(() => {
                    python.kill();
                    resolve(null);
                }, 2000);
            });
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
        const text = line.text;

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
                    const range = line.range;
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
