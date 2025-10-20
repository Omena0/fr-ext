import * as vscode from 'vscode';
import { PythonInteropProvider, createPythonInteropDiagnostics } from './pythonInterop';
import { MetricsProvider } from './analysis';
import { DocumentationProvider } from './documentation';
import { RefactoringProvider } from './refactoring';
import { EnhancedCodeActionProvider, createOrganizeImportsCommand, createSortMembersCommand } from './codeActions';
import { registerTaskProvider, createRunCurrentFileCommand, createBuildCurrentFileCommand } from './taskProvider';
import { registerWorkspaceSymbolProvider, createFindSymbolCommand } from './workspaceSymbols';
import { registerFormattingProviders } from './formatting';
import { registerColorProvider, createInsertColorCommand } from './colorProvider';
import { DependencyManager } from './dependencyManager';
// Lazy load debug adapter to avoid import errors
// import { FrscriptDebugSession } from './debugAdapter';
import { debounce } from './utils';

interface FunctionInfo {
    name: string;
    signature: string;
    description: string;
    insertText?: string;
    detail?: string;
    deprecated?: boolean;
    message?: string;
}

interface DocstringInfo {
    documentation: string;
    line: number;
}

interface StructField {
    name: string;
    type: string;
}

interface FunctionParameter {
    name: string;
    type: string;
}

interface SymbolInfo {
    name: string;
    type: 'function' | 'struct' | 'variable';
    line: number;
    documentation?: string;
    fields?: StructField[];  // For structs
    returnType?: string;  // For functions
    parameters?: FunctionParameter[];  // For functions
    varType?: string;  // For variables
    endLine?: number;  // For scope tracking
}

// Built-in functions
const builtinFunctions: FunctionInfo[] = [
    {
        name: 'println',
        signature: 'println(value: any)',
        description: 'Print a value followed by a newline',
        insertText: 'println($1)$0',
        detail: 'void println(value: any)'
    },
    {
        name: 'print',
        signature: 'print(value: any)',
        description: 'Print a value without a newline',
        insertText: 'print($1)$0',
        detail: 'void print(value: any)'
    },
    { name: 'input', signature: 'input(prompt: str) -> str', description: 'Read a line of input from the user', insertText: 'input($1)$0' },
    { name: 'len', signature: 'len(collection: list|str) -> int', description: 'Return the length of a list or string', insertText: 'len($1)$0' },
    { name: 'str', signature: 'str(value: any) -> str', description: 'Convert a value to a string', insertText: 'str($1)$0' },
    { name: 'int', signature: 'int(value: any) -> int', description: 'Convert a value to an integer', insertText: 'int($1)$0' },
    { name: 'float', signature: 'float(value: any) -> float', description: 'Convert a value to a float', insertText: 'float($1)$0' },
    { name: 'bool', signature: 'bool(value: any) -> bool', description: 'Convert a value to a boolean', insertText: 'bool($1)$0' },
    { name: 'split', signature: 'split(text: str, delimiter: str) -> list', description: 'Split a string by delimiter', insertText: 'split($1, $2)$0' },
    { name: 'join', signature: 'join(items: list, separator: str) -> str', description: 'Join list items with separator', insertText: 'join($1, $2)$0' },
    { name: 'fopen', signature: 'fopen(path: str, mode: str = "r") -> int', description: 'Open a file and return file descriptor', insertText: 'fopen($1)$0' },
    { name: 'fread', signature: 'fread(fd: int, size: int = -1) -> str', description: 'Read from file descriptor', insertText: 'fread($1)$0' },
    { name: 'fwrite', signature: 'fwrite(fd: int, data: str) -> int', description: 'Write to file descriptor', insertText: 'fwrite($1, $2)$0' },
    { name: 'fclose', signature: 'fclose(fd: int)', description: 'Close file descriptor', insertText: 'fclose($1)$0' },
    { name: 'fork', signature: 'fork() -> int', description: 'Fork the current process (returns 0 in child, child PID in parent, -1 on error)', insertText: 'fork()$0' },
    { name: 'wait', signature: 'wait(pid: int) -> int', description: 'Wait for child process to finish (returns exit status, -1 on error)', insertText: 'wait($1)$0' },
    { name: 'sleep', signature: 'sleep(seconds: float)', description: 'Sleep for specified number of seconds', insertText: 'sleep($1)$0' },
    { name: 'socket', signature: 'socket(family: str = "inet", type: str = "stream") -> int', description: 'Create a socket', insertText: 'socket($1, $2)$0' },
    { name: 'bind', signature: 'bind(sock_id: int, host: str, port: int)', description: 'Bind socket to address', insertText: 'bind($1, $2, $3)$0' },
    { name: 'listen', signature: 'listen(sock_id: int, backlog: int = 5)', description: 'Listen for connections', insertText: 'listen($1)$0' },
    { name: 'accept', signature: 'accept(sock_id: int) -> int', description: 'Accept a connection', insertText: 'accept($1)$0' },
    { name: 'send', signature: 'send(sock_id: int, data: bytes) -> int', description: 'Send data through socket', insertText: 'send($1, $2)$0' },
    { name: 'recv', signature: 'recv(sock_id: int, size: int = 4096) -> bytes', description: 'Receive data from socket', insertText: 'recv($1)$0' },
    { name: 'sclose', signature: 'sclose(sock_id: int)', description: 'Close socket', insertText: 'sclose($1)$0' },
    { name: 'py_import', signature: 'py_import(module: str)', description: 'Import a Python module', insertText: 'py_import $1$0' },
    { name: 'py_call', signature: 'py_call(module: str, function: str, ...args) -> any', description: 'Call a Python function', insertText: 'py_call("$1", "$2"$3)$0' },
    { name: 'sqrt', signature: 'sqrt(x: float) -> float', description: 'Square root', insertText: 'sqrt($1)$0' },
    { name: 'assert', signature: 'assert(condition: bool, message: str = "")', description: 'Assert that a condition is true', insertText: 'assert($1)$0' },
];

const keywords = ['if', 'elif', 'else', 'while', 'for', 'in', 'switch', 'case', 'default', 'break', 'continue', 'return', 'assert', 'const', 'struct', 'py_import', 'from', 'as', 'try', 'except', 'raise', 'goto', 'global'];
const types = ['void', 'int', 'float', 'str', 'string', 'bool', 'list', 'dict', 'set', 'bytes', 'any', 'pyobject', 'pyobj'];

// Extract docstrings from document
function parseDocstrings(document: vscode.TextDocument): Map<number, DocstringInfo> {
    const docstrings = new Map<number, DocstringInfo>();

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const match = line.text.match(/^\s*\/\/\/\s*(.+)$/);

        if (match) {
            // Found a docstring, it applies to the next non-comment line
            const doc = match[1].trim();
            let targetLine = i + 1;

            // Skip additional docstring lines
            while (targetLine < document.lineCount) {
                const nextLine = document.lineAt(targetLine).text;
                if (nextLine.match(/^\s*\/\/\//)) {
                    targetLine++;
                } else {
                    break;
                }
            }

            if (targetLine < document.lineCount) {
                const existing = docstrings.get(targetLine);
                if (existing) {
                    docstrings.set(targetLine, { documentation: existing.documentation + '\n\n' + doc, line: targetLine });
                } else {
                    docstrings.set(targetLine, { documentation: doc, line: targetLine });
                }
            }
        }
    }

    return docstrings;
}

// Parse symbols (functions and structs) with their docstrings
function parseSymbols(document: vscode.TextDocument): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const docstrings = parseDocstrings(document);

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const { text } = line;

        // Match function declarations
        const funcMatch = text.match(/^\s*(void|int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj)\s+(\w+)\s*\(([^)]*)\)/);
        if (funcMatch) {
            const doc = docstrings.get(i);
            const returnType = funcMatch[1];
            const functionName = funcMatch[2];
            const paramsText = funcMatch[3].trim();

            // Parse parameters
            const parameters: FunctionParameter[] = [];
            if (paramsText) {
                const paramList = paramsText.split(',');
                for (const param of paramList) {
                    const trimmedParam = param.trim();
                    // Try to match typed parameter: type name
                    const typedMatch = trimmedParam.match(/^(void|int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj)\s+(\w+)$/);
                    if (typedMatch) {
                        parameters.push({
                            type: typedMatch[1],
                            name: typedMatch[2]
                        });
                    } else {
                        // Try to match untyped parameter: just name
                        const untypedMatch = trimmedParam.match(/^(\w+)$/);
                        if (untypedMatch) {
                            parameters.push({
                                type: 'any',  // Untyped parameters are treated as 'any'
                                name: untypedMatch[1]
                            });
                        }
                    }
                }
            }

            symbols.push({
                name: functionName,
                type: 'function',
                line: i,
                documentation: doc?.documentation,
                returnType: returnType,
                parameters: parameters
            });
        }

        // Match struct declarations
        const structMatch = text.match(/^\s*struct\s+(\w+)\s*\{/);
        if (structMatch) {
            const doc = docstrings.get(i);
            const fields: StructField[] = [];

            // Parse struct fields
            let currentLine = i + 1;
            while (currentLine < document.lineCount) {
                const fieldLine = document.lineAt(currentLine).text;

                // Check for end of struct
                if (fieldLine.match(/^\s*\}/)) {
                    break;
                }

                // Match field declaration: type name
                const fieldMatch = fieldLine.match(/^\s*(void|int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj)\s+(\w+)\s*/);
                if (fieldMatch) {
                    fields.push({
                        type: fieldMatch[1],
                        name: fieldMatch[2]
                    });
                }

                currentLine++;
            }

            symbols.push({
                name: structMatch[1],
                type: 'struct',
                line: i,
                documentation: doc?.documentation,
                fields: fields
            });
        }

        // Match variable declarations
        const varMatch = text.match(/^\s*(int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj)\s+(\w+)\s*=/);
        if (varMatch) {
            symbols.push({
                name: varMatch[2],
                type: 'variable',
                line: i,
                varType: varMatch[1]
            });
        }
    }

    return symbols;
}

// Diagnostic collection for errors
let diagnosticCollection: vscode.DiagnosticCollection;

// Validate document for errors
function validateDocument(document: vscode.TextDocument) {
    if (document.languageId !== 'frscript') {
        return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const {text} = line;

        // Check for unclosed parentheses
        const openParens = (text.match(/\(/g) || []).length;
        const closeParens = (text.match(/\)/g) || []).length;
        if (openParens > closeParens && !text.includes('//')) {
            const range = new vscode.Range(i, 0, i, text.length);
            const diagnostic = new vscode.Diagnostic(
                range,
                'Unclosed parenthesis',
                vscode.DiagnosticSeverity.Error
            );
            diagnostics.push(diagnostic);
        }

        // Check for invalid function declarations (missing return type)
        // Only check at indent level 0 (no leading whitespace)
        const invalidFuncMatch = text.match(/^(\w+)\s*\([^)]*\)\s*\{/);
        if (invalidFuncMatch) {
            const identifier = invalidFuncMatch[1];
            const controlFlowKeywords = ['if', 'elif', 'else', 'while', 'for', 'switch', 'case', 'default'];
            if (!types.includes(identifier) &&
                identifier !== 'struct' &&
                !controlFlowKeywords.includes(identifier)) {
                const start = 0;
                const range = new vscode.Range(i, start, i, text.length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Missing return type for function. Did you mean 'void ${identifier}'?`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostics.push(diagnostic);
            }
        }

        // Check for semicolons (error in Frscript - no semicolons allowed)
        const semicolonMatch = text.match(/;(?!.*\/\/)/);  // Ignore if in comment
        if (semicolonMatch && !text.trim().startsWith('//')) {
            const start = text.indexOf(';');
            const range = new vscode.Range(i, start, i, start + 1);
            const diagnostic = new vscode.Diagnostic(
                range,
                'Frscript does not use semicolons',
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'no-semicolons';
            diagnostics.push(diagnostic);
        }
    }

    // Type checking for function calls and struct construction
    const symbols = parseSymbols(document);
    const userFunctions = symbols.filter(s => s.type === 'function');
    const userStructs = symbols.filter(s => s.type === 'struct');

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const {text} = line;

        // Match function calls and struct construction: Name(args)
        const funcCallRegex = /(\w+)\s*\(([^)]*)\)/g;
        let match;

        while ((match = funcCallRegex.exec(text)) !== null) {
            const funcName = match[1];
            const argsText = match[2].trim();
            const callStart = match.index;

            // Check if it's a struct construction
            const structDef = userStructs.find(s => s.name === funcName);
            if (structDef && structDef.fields) {
                // Parse arguments
                const args: string[] = [];
                if (argsText) {
                    const argList = argsText.split(',').map(a => a.trim());
                    args.push(...argList);
                }

                // Check argument count
                if (args.length !== structDef.fields.length) {
                    const range = new vscode.Range(i, callStart, i, callStart + match[0].length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Struct '${funcName}' expects ${structDef.fields.length} field(s), but got ${args.length}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostics.push(diagnostic);
                    continue;
                }

                // Check field types
                for (let argIdx = 0; argIdx < args.length; argIdx++) {
                    const arg = args[argIdx];
                    const expectedType = structDef.fields[argIdx].type;
                    const inferredType = inferType(arg);

                    if (inferredType && expectedType !== 'any' && inferredType !== expectedType) {
                        const argStart = text.indexOf(arg, callStart);
                        const range = new vscode.Range(i, argStart, i, argStart + arg.length);
                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Type mismatch in struct '${funcName}': field '${structDef.fields[argIdx].name}' expects '${expectedType}', but got '${inferredType}'`,
                            vscode.DiagnosticSeverity.Error
                        );
                        diagnostics.push(diagnostic);
                    }
                }
                continue;
            }

            // Find the function definition
            const funcDef = userFunctions.find(f => f.name === funcName);
            if (!funcDef || !funcDef.parameters) {
                continue;
            }

            // Parse arguments
            const args: string[] = [];
            if (argsText) {
                // Simple argument parsing (doesn't handle nested parentheses perfectly)
                const argList = argsText.split(',').map(a => a.trim());
                args.push(...argList);
            }

            // Check argument count
            if (args.length !== funcDef.parameters.length) {
                const range = new vscode.Range(i, callStart, i, callStart + match[0].length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Function '${funcName}' expects ${funcDef.parameters.length} argument(s), but got ${args.length}`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostics.push(diagnostic);
                continue;
            }

            // Check argument types
            for (let argIdx = 0; argIdx < args.length; argIdx++) {
                const arg = args[argIdx];
                const expectedType = funcDef.parameters[argIdx].type;
                const inferredType = inferType(arg);

                if (inferredType && expectedType !== 'any' && inferredType !== expectedType) {
                    const argStart = text.indexOf(arg, callStart);
                    const range = new vscode.Range(i, argStart, i, argStart + arg.length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Type mismatch: expected '${expectedType}', but got '${inferredType}'`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    // Check for variable assignment type mismatches
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const {text} = line;

        // Match variable declarations with initialization: type name = value
        const varDeclMatch = text.match(/^\s*(int|float|str|string|bool|list|dict|set|any|pyobject|pyobj)\s+(\w+)\s*=\s*(.+)$/);
        if (varDeclMatch) {
            const declaredType = varDeclMatch[1];
            const varName = varDeclMatch[2];
            const value = varDeclMatch[3].trim();

            // Skip 'any' type as it accepts anything
            if (declaredType === 'any') {
                continue;
            }

            // Find which function we're in to include its parameters
            let currentFunction: SymbolInfo | undefined;
            for (const func of userFunctions) {
                if (func.line >= i) {
                    continue; // Function is after this line
                }
                
                // Find the end of this function by counting braces
                let braceCount = 0;
                let functionEnded = false;
                for (let j = func.line; j <= i && j < document.lineCount; j++) {
                    const checkLine = document.lineAt(j).text;
                    for (const char of checkLine) {
                        if (char === '{') {
                            braceCount++;
                        } else if (char === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                // Function ended
                                functionEnded = true;
                                break;
                            }
                        }
                    }
                    if (functionEnded) {
                        break;
                    }
                }
                
                // If we're still in this function at line i (didn't end and has opened)
                if (!functionEnded && braceCount > 0) {
                    currentFunction = func;
                    break; // Found the containing function
                }
            }

            // Build symbols list including function parameters.
            // Place function parameters first so they shadow globals with the same name.
            let symbolsForTypeChecking: SymbolInfo[] = [];
            if (currentFunction && currentFunction.parameters) {
                // Add function parameters as pseudo-variables for type checking (take precedence)
                currentFunction.parameters.forEach(param => {
                    symbolsForTypeChecking.push({
                        name: param.name,
                        type: 'variable',
                        line: currentFunction!.line,
                        varType: param.type
                    });
                });
            }

            // Then add the rest of the known symbols (globals, functions, structs, etc.)
            symbolsForTypeChecking = symbolsForTypeChecking.concat([...symbols]);

            // Infer the type of the value
            const inferredType = inferReturnType(value, symbolsForTypeChecking);

            // Skip if inferred type is 'any' (can be assigned to anything)
            // or if types match
            if (inferredType && inferredType !== 'any' && inferredType !== declaredType) {
                const valueStart = text.indexOf('=') + 1;
                const valuePos = text.indexOf(value, valueStart);
                const range = new vscode.Range(i, valuePos, i, valuePos + value.length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Type mismatch: cannot assign '${inferredType}' to variable of type '${declaredType}'`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.code = 'type-mismatch';
                diagnostics.push(diagnostic);
            }
        }
    }

    // Check for unused functions and variables
    const allText = document.getText();
    const userVariables = symbols.filter(s => s.type === 'variable');

    // Check return type mismatches in functions
    userFunctions.forEach(func => {
        if (!func.returnType || func.returnType === 'void' || func.returnType === 'any') {
            return; // Skip void and any functions
        }

        // Find function body
        let funcStartLine = func.line;
        let funcEndLine = func.endLine || funcStartLine;

        // If endLine not set, find the closing brace
        if (!func.endLine) {
            let braceCount = 0;
            let foundStart = false;

            for (let i = funcStartLine; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;

                for (const char of line) {
                    if (char === '{') {
                        braceCount++;
                        foundStart = true;
                    } else if (char === '}') {
                        braceCount--;
                        if (foundStart && braceCount === 0) {
                            funcEndLine = i;
                            break;
                        }
                    }
                }

                if (foundStart && braceCount === 0) {
                    break;
                }
            }
        }

        // Parse local variables within the function and include parameters
        const localVars: SymbolInfo[] = [];

        // First add function parameters so they take precedence over globals
        if (func.parameters && func.parameters.length > 0) {
            func.parameters.forEach(p => {
                localVars.push({
                    name: p.name,
                    type: 'variable',
                    line: func.line,
                    varType: p.type
                });
            });
        }

        for (let i = funcStartLine + 1; i <= funcEndLine; i++) {
            const line = document.lineAt(i).text;
            const varMatch = line.match(/^\s*(int|float|str|string|bool|list|dict|set|any|pyobject|pyobj)\s+(\w+)\s*=/);
            if (varMatch) {
                localVars.push({
                    name: varMatch[2],
                    type: 'variable',
                    line: i,
                    varType: varMatch[1]
                });
            }
        }

        // Combine local variables (including params) with global symbols for type checking
        // Put local vars first so they take precedence in lookups
        const allSymbols = [...localVars, ...symbols];

        // Check all return statements in the function
        for (let i = funcStartLine + 1; i <= funcEndLine; i++) {
            const line = document.lineAt(i);
            const {text} = line;

            // Match return statements
            const returnMatch = text.match(/^\s*return\s+(.+?)$/);
            if (returnMatch) {
                const returnValue = returnMatch[1].trim();
                const inferredType = inferReturnType(returnValue, allSymbols);

                // Only flag type mismatches if we can confidently infer the type
                // and it doesn't match the function's return type
                if (inferredType && inferredType !== 'any' && inferredType !== func.returnType && func.returnType !== 'any') {
                    const returnPos = text.indexOf('return');
                    const valueStart = returnPos + 7; // length of "return "
                    const range = new vscode.Range(i, valueStart, i, text.length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Return type mismatch in function '${func.name}': expected '${func.returnType}', but got '${inferredType}'`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.code = 'return-type-mismatch';
                    diagnostics.push(diagnostic);
                }
            }
        }

        // Check if non-void function has a return statement
        let hasReturn = false;
        for (let i = funcStartLine + 1; i <= funcEndLine; i++) {
            const line = document.lineAt(i);
            if (line.text.match(/^\s*return\s+/)) {
                hasReturn = true;
                break;
            }
        }

        if (!hasReturn && func.returnType !== 'void') {
            const line = document.lineAt(funcStartLine);
            const funcNamePos = line.text.indexOf(func.name);
            const range = new vscode.Range(funcStartLine, funcNamePos, funcStartLine, funcNamePos + func.name.length);
            const diagnostic = new vscode.Diagnostic(
                range,
                `Function '${func.name}' with return type '${func.returnType}' must return a value`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.code = 'missing-return';
            diagnostics.push(diagnostic);
        }
    });

    // Check unused functions (exclude main)
    userFunctions.forEach(func => {
        if (func.name === 'main') {
          return;
        }  // main is always "used"

        // Search for function calls
        const callRegex = new RegExp(`\\b${func.name}\\s*\\(`, 'g');
        const calls = allText.match(callRegex) || [];

        // Subtract 1 for the definition itself
        if (calls.length <= 1) {
            const line = document.lineAt(func.line);
            const start = line.text.indexOf(func.name);
            const range = new vscode.Range(func.line, start, func.line, start + func.name.length);
            const diagnostic = new vscode.Diagnostic(
                range,
                `Function '${func.name}' is declared but never used`,
                vscode.DiagnosticSeverity.Hint
            );
            diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
            diagnostics.push(diagnostic);
        }
    });

    // Check unused variables
    userVariables.forEach(variable => {
        // Search for variable usage
        const usageRegex = new RegExp(`\\b${variable.name}\\b`, 'g');
        const uses = allText.match(usageRegex) || [];

        // Subtract 1 for the declaration itself
        if (uses.length <= 1) {
            const line = document.lineAt(variable.line);
            const start = line.text.indexOf(variable.name);
            const range = new vscode.Range(variable.line, start, variable.line, start + variable.name.length);
            const diagnostic = new vscode.Diagnostic(
                range,
                `Variable '${variable.name}' is declared but never used`,
                vscode.DiagnosticSeverity.Hint
            );
            diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
            diagnostics.push(diagnostic);
        }
    });

    diagnosticCollection.set(document.uri, diagnostics);
}

// Infer the type of a value/expression
function inferType(value: string): string | null {
    value = value.trim();

    // String literals
    if (value.startsWith('"') && value.endsWith('"')) {
        return 'str';
    }
    if (value.startsWith("'") && value.endsWith("'")) {
        return 'str';
    }
    
    // F-string literals
    if (value.startsWith('f"') || value.startsWith("f'")) {
        return 'str';
    }
    
    // Bytes literals
    if (value.startsWith('b"') || value.startsWith("b'")) {
        return 'bytes';
    }

    // Integer literals
    if (/^-?\d+$/.test(value)) {
        return 'int';
    }

    // Float literals
    if (/^-?\d+\.\d+$/.test(value)) {
        return 'float';
    }

    // Boolean literals
    if (value === 'true' || value === 'false') {
        return 'bool';
    }

    // List literals
    if (value.startsWith('[') && value.endsWith(']')) {
        return 'list';
    }
    
    // Dict and Set literals (both use curly braces)
    if (value.startsWith('{') && value.endsWith('}')) {
        // Empty {} is ambiguous, but typically treated as dict
        if (value === '{}') {
            return 'dict';
        }
        
        // Check if it contains key:value pairs (dict) or just values (set)
        // Simple heuristic: if there's a colon not in a string, it's likely a dict
        const withoutStrings = value.replace(/"[^"]*"|'[^']*'/g, '');
        if (withoutStrings.includes(':')) {
            return 'dict';
        } else {
            return 'set';
        }
    }

    // Can't infer type for variables/expressions
    return null;
}

// Infer the return type of a more complex expression
function inferReturnType(value: string, symbols: SymbolInfo[]): string | null {
    value = value.trim();

    // First try basic type inference
    const basicType = inferType(value);
    if (basicType) {
        return basicType;
    }

    // Check for function calls
    const funcCallMatch = value.match(/^(\w+)\s*\(/);
    if (funcCallMatch) {
        const funcName = funcCallMatch[1];

        // Check user-defined functions
        const func = symbols.find(s => s.type === 'function' && s.name === funcName);
        if (func && func.returnType) {
            return func.returnType;
        }

        // Check built-in functions with known return types
        const builtinReturnTypes: Record<string, string> = {
            // Type conversion functions
            'str': 'str',
            'int': 'int',
            'float': 'float',
            'bool': 'bool',
            
            // Collection functions
            'len': 'int',
            'append': 'list',
            'pop': 'any',
            
            // String functions
            'input': 'str',
            'split': 'list',
            'join': 'str',
            'upper': 'str',
            'lower': 'str',
            'strip': 'str',
            'replace': 'str',
            
            // Math functions
            'sqrt': 'float',
            'abs': 'any',
            'round': 'int',
            'floor': 'int',
            'ceil': 'int',
            'pow': 'any',
            'min': 'any',
            'max': 'any',
            'sin': 'float',
            'cos': 'float',
            'tan': 'float',
            'PI': 'float',
            'E': 'float',
            
            // File I/O functions
            'fopen': 'int',
            'fread': 'str',
            'fwrite': 'int',
            'exists': 'bool',
            'isfile': 'bool',
            'isdir': 'bool',
            'listdir': 'list',
            'getsize': 'int',
            'getcwd': 'str',
            'abspath': 'str',
            'basename': 'str',
            'dirname': 'str',
            'pathjoin': 'str',
            
            // Process management
            'fork': 'int',
            'wait': 'int',
            'sleep': 'void',
            
            // Socket functions
            'socket': 'int',
            'accept': 'int',
            'send': 'int',
            'recv': 'str',
            
            // Python interop
            'py_call': 'any',
            'py_getattr': 'any',
            'py_call_method': 'any'
        };

        if (builtinReturnTypes[funcName]) {
            return builtinReturnTypes[funcName];
        }
    }

    // Check for struct construction
    const structMatch = value.match(/^(\w+)\s*\(/);
    if (structMatch) {
        const structName = structMatch[1];
        const struct = symbols.find(s => s.type === 'struct' && s.name === structName);
        if (struct) {
            return structName; // Struct type is the struct name itself
        }
    }

    // Check for arithmetic operations
    if (value.includes('+') || value.includes('-') || value.includes('*') || value.includes('/')) {
        // Division always returns float
        if (value.includes('/')) {
            return 'float';
        }

        // If it contains a decimal point or float operation, it's float
        if (value.includes('.') || value.match(/\bfloat\(/)) {
            return 'float';
        }

        // Check if any operands are float variables (if either one is float, result is float)
        const operands = value.split(/[\+\-\*\/]/).map(op => op.trim());
        for (const operand of operands) {
            // Check if it's a variable
            const variable = symbols.find(s => s.type === 'variable' && s.name === operand);
            if (variable && variable.varType === 'float') {
                return 'float';
            }
        }

        // Otherwise assume int
        return 'int';
    }

    // Check for comparison operations
    if (value.includes('==') || value.includes('!=') || value.includes('<') ||
        value.includes('>') || value.includes('<=') || value.includes('>=') ||
        value.includes('and') || value.includes('or') || value.includes('not')) {
        return 'bool';
    }

    // Check for string concatenation
    if (value.includes('+') && (value.includes('"') || value.includes("'") || value.match(/\bstr\(/))) {
        return 'str';
    }

    // Check for variable references
    const varMatch = value.match(/^(\w+)$/);
    if (varMatch) {
        const varName = varMatch[1];
        const variable = symbols.find(s => s.type === 'variable' && s.name === varName);
        if (variable && variable.varType) {
            return variable.varType;
        }
    }

    // Check for field access (struct.field)
    const fieldMatch = value.match(/^(\w+)\.(\w+)$/);
    if (fieldMatch) {
        const varName = fieldMatch[1];
        const fieldName = fieldMatch[2];

        // Find the variable
        const variable = symbols.find(s => s.type === 'variable' && s.name === varName);
        if (variable && variable.varType) {
            // Find the struct definition
            const struct = symbols.find(s => s.type === 'struct' && s.name === variable.varType);
            if (struct && struct.fields) {
                const field = struct.fields.find(f => f.name === fieldName);
                if (field) {
                    return field.type;
                }
            }
        }
    }

    // Check for list indexing
    if (value.match(/\w+\[\d+\]/)) {
        // Could be list or string, but we can't determine the element type
        return null;
    }

    // Can't infer type
    return null;
}

export function activate(context: vscode.ExtensionContext) {
    // Only log to console when extension development host is active
    const isExtensionDevelopment = context.extensionMode === vscode.ExtensionMode.Development;
    
    // Auto-activate .venv if it exists
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const venvPath = require('path').join(workspaceRoot, '.venv');
        const fs = require('fs');
        
        // Check if .venv exists
        if (fs.existsSync(venvPath)) {
            // Get Python extension API
            const pythonExtension = vscode.extensions.getExtension('ms-python.python');
            if (pythonExtension) {
                if (!pythonExtension.isActive) {
                    pythonExtension.activate().then(() => {
                        // Set the Python path to use .venv
                        const pythonPath = process.platform === 'win32' ? 
                            require('path').join(venvPath, 'Scripts', 'python.exe') :
                            require('path').join(venvPath, 'bin', 'python');
                        
                        vscode.workspace.getConfiguration('python').update(
                            'defaultInterpreterPath',
                            pythonPath,
                            vscode.ConfigurationTarget.Workspace
                        );
                        
                        if (isExtensionDevelopment) {
                            console.log(`Auto-activated .venv: ${pythonPath}`);
                        }
                    });
                } else {
                    // Python extension already active, just set the path
                    const pythonPath = process.platform === 'win32' ? 
                        require('path').join(venvPath, 'Scripts', 'python.exe') :
                        require('path').join(venvPath, 'bin', 'python');
                    
                    vscode.workspace.getConfiguration('python').update(
                        'defaultInterpreterPath',
                        pythonPath,
                        vscode.ConfigurationTarget.Workspace
                    );
                    
                    if (isExtensionDevelopment) {
                        console.log(`Auto-activated .venv: ${pythonPath}`);
                    }
                }
            }
        }
    }
    
    // Create output channel for debugger logs
    const debugOutputChannel = vscode.window.createOutputChannel('Frscript Debugger');
    if (isExtensionDevelopment) {
        console.log('Created output channel:', debugOutputChannel);
    }
    context.subscriptions.push(debugOutputChannel);

    // Make it available globally for the debugger
    (global as any).frscriptDebugOutput = debugOutputChannel;

    // Log that extension is activated
    debugOutputChannel.appendLine('=== Frscript Extension Activated ===');
    debugOutputChannel.appendLine(`Activation time: ${new Date().toISOString()}`);
    debugOutputChannel.appendLine('Debug output channel is ready');
    debugOutputChannel.appendLine('');

    if (isExtensionDevelopment) {
        console.log('Extension activated successfully');
    }

    // Add command to show debug output
    const showDebugOutputCommand = vscode.commands.registerCommand('frscript.showDebugOutput', () => {
        debugOutputChannel.show();
    });
    context.subscriptions.push(showDebugOutputCommand);

    if (isExtensionDevelopment) {
        console.log('About to initialize providers');
    }

    // Initialize providers
    const pythonProvider = new PythonInteropProvider();
    const metricsProvider = new MetricsProvider();
    const documentationProvider = new DocumentationProvider();
    const refactoringProvider = new RefactoringProvider();
    const dependencyManager = new DependencyManager();

    // Create diagnostic collection
    diagnosticCollection = vscode.languages.createDiagnosticCollection('frscript');
    context.subscriptions.push(diagnosticCollection);

    // Enhanced validation with all diagnostic sources
    const validateDocumentEnhanced = debounce((document: vscode.TextDocument) => {
        if (document.languageId !== 'frscript') {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];

        // Original diagnostics
        validateDocument(document);

        // Add Python interop diagnostics
        diagnostics.push(...createPythonInteropDiagnostics(document, pythonProvider));

        // Add metrics diagnostics
        diagnostics.push(...metricsProvider.createMetricsDiagnostics(document));

        // Merge with existing diagnostics
        const existingDiagnostics = diagnosticCollection.get(document.uri) || [];
        diagnosticCollection.set(document.uri, [...existingDiagnostics, ...diagnostics]);
    }, 500);

    // Validate on open and change
    if (vscode.window.activeTextEditor) {
        validateDocument(vscode.window.activeTextEditor.document);
        validateDocumentEnhanced(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            validateDocument(e.document);
            validateDocumentEnhanced(e.document);
            pythonProvider.clearCache(e.document);
        }),
        vscode.workspace.onDidOpenTextDocument(doc => {
            validateDocument(doc);
            validateDocumentEnhanced(doc);
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                validateDocument(editor.document);
                validateDocumentEnhanced(editor.document);
            }
        })
    );

    // Update metrics status bar on cursor move
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (e.textEditor.document.languageId === 'frscript') {
                metricsProvider.updateStatusBar(e.textEditor.document, e.selections[0].active);
            }
        })
    );

    // Register all providers
    registerFormattingProviders(context);
    registerColorProvider(context);
    registerTaskProvider(context);
    registerWorkspaceSymbolProvider(context);

    // Enhanced completion provider
    const completionProvider = vscode.languages.registerCompletionItemProvider('frscript', {
        async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
            const completionItems: vscode.CompletionItem[] = [];
            
            // Check if we're typing after a dot (for Python module members)
            const lineText = document.lineAt(position.line).text;
            const textBeforeCursor = lineText.substring(0, position.character);
            const dotMatch = textBeforeCursor.match(/(\w+)\.(\w*)$/);
            
            if (dotMatch) {
                const objectName = dotMatch[1];
                const partialAttribute = dotMatch[2];
                
                // First check if it's a Python module
                const pythonImports = pythonProvider.getImports(document);
                const pythonImport = pythonImports.find(imp => 
                    imp.alias === objectName || imp.name === objectName
                );
                
                if (pythonImport) {
                    // Get module members using Python introspection
                    const members = await pythonProvider.getModuleMembers(pythonImport.name);
                    
                    if (members && members.length > 0) {
                        members.forEach(member => {
                            const item = new vscode.CompletionItem(member.name, 
                                member.type === 'class' ? vscode.CompletionItemKind.Class :
                                member.type === 'function' ? vscode.CompletionItemKind.Function :
                                vscode.CompletionItemKind.Variable
                            );
                            item.detail = member.signature || `${pythonImport.name}.${member.name}`;
                            if (member.doc) {
                                item.documentation = new vscode.MarkdownString(member.doc);
                            }
                            completionItems.push(item);
                        });
                        
                        return completionItems;
                    }
                } else {
                    // Check if it's a variable that was assigned from a Python class
                    // Look for pattern: pyobj variableName = module.ClassName(...)
                    const text = document.getText();
                    const varAssignPattern = new RegExp(`pyobj\\s+${objectName}\\s*=\\s*(\\w+)\\.(\\w+)\\s*\\(`, 'g');
                    const varMatch = varAssignPattern.exec(text);
                    
                    if (varMatch) {
                        const moduleName = varMatch[1];
                        const className = varMatch[2];
                        
                        // Find the Python module
                        const moduleImport = pythonImports.find(imp => 
                            imp.alias === moduleName || imp.name === moduleName
                        );
                        
                        if (moduleImport) {
                            // Get members of the class
                            const members = await pythonProvider.getClassMembers(moduleImport.name, className);
                            
                            if (members && members.length > 0) {
                                members.forEach(member => {
                                    const item = new vscode.CompletionItem(member.name, 
                                        member.type === 'method' ? vscode.CompletionItemKind.Method :
                                        vscode.CompletionItemKind.Property
                                    );
                                    item.detail = member.signature || `${className}.${member.name}`;
                                    if (member.doc) {
                                        item.documentation = new vscode.MarkdownString(member.doc);
                                    }
                                    completionItems.push(item);
                                });
                                
                                return completionItems;
                            }
                        }
                    }
                }
            }

            // Add built-in functions with better suggestions
            builtinFunctions.forEach(func => {
                const item = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
                item.detail = func.detail || func.signature;
                item.documentation = new vscode.MarkdownString(func.description);

                if (func.insertText) {
                    item.insertText = new vscode.SnippetString(func.insertText);
                }

                if (func.deprecated) {
                    item.tags = [vscode.CompletionItemTag.Deprecated];
                }

                // Boost println over print
                if (func.name === 'println') {
                    item.sortText = '0_println';
                }

                completionItems.push(item);
            });

            // Add user-defined symbols
            const symbols = parseSymbols(document);
            symbols.forEach(symbol => {
                const kind = symbol.type === 'function' ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Class;
                const item = new vscode.CompletionItem(symbol.name, kind);
                if (symbol.documentation) {
                    item.documentation = new vscode.MarkdownString(symbol.documentation);
                }
                completionItems.push(item);
            });

            // Add keywords
            keywords.forEach(keyword => {
                const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
                completionItems.push(item);
            });

            // Add types
            types.forEach(type => {
                const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.TypeParameter);
                completionItems.push(item);
            });

            return completionItems;
        }
    }, '.');

    // Enhanced hover provider with docstring support
    const hoverProvider = vscode.languages.registerHoverProvider('frscript', {
        async provideHover(document: vscode.TextDocument, position: vscode.Position) {
            if (isExtensionDevelopment) {
                console.log('HOVER CALLED at position:', position.line, position.character);
            }
            
            const wordRange = document.getWordRangeAtPosition(position);
            const word = document.getText(wordRange);
            
            if (isExtensionDevelopment) {
                console.log('Word under cursor:', word);
            }
            
            if (!word) {
                return undefined;
            }

            // Check built-in functions
            const func = builtinFunctions.find(f => f.name === word);
            if (func) {
                const markdown = new vscode.MarkdownString();
                markdown.appendCodeblock(func.signature, 'frscript');
                markdown.appendMarkdown('\n\n' + func.description);
                if (func.deprecated) {
                    markdown.appendMarkdown('\n\n⚠️ **Deprecated**: ' + (func.message || 'This function is deprecated'));
                }
                return new vscode.Hover(markdown);
            }

            // Check user-defined symbols
            const symbols = parseSymbols(document);
            const symbol = symbols.find(s => s.name === word);
            if (symbol) {
                const markdown = new vscode.MarkdownString();

                if (symbol.type === 'function') {
                    const line = document.lineAt(symbol.line).text;
                    markdown.appendCodeblock(line.trim(), 'frscript');
                } else if (symbol.type === 'variable') {
                    // Variable - show type and declaration
                    const line = document.lineAt(symbol.line).text;
                    markdown.appendCodeblock(line.trim(), 'frscript');
                } else if (symbol.type === 'struct') {
                    // Struct - show with fields
                    let structCode = `struct ${symbol.name} {\n`;
                    if (symbol.fields && symbol.fields.length > 0) {
                        symbol.fields.forEach(field => {
                            structCode += `    ${field.type} ${field.name};\n`;
                        });
                    }
                    structCode += '}';
                    markdown.appendCodeblock(structCode, 'frscript');
                }

                if (symbol.documentation) {
                    markdown.appendMarkdown('\n\n' + symbol.documentation);
                }

                return new vscode.Hover(markdown);
            }

            // Check for Python attribute access (e.g., ui.Window or window.title)
            const lineText = document.lineAt(position.line).text;
            
            // Get the end of the current word to check for module.attribute pattern
            const wordEndIndex = wordRange ? wordRange.end.character : position.character;
            const textUpToWordEnd = lineText.substring(0, wordEndIndex);
            const attributeMatch = textUpToWordEnd.match(/(\w+)\.(\w+)$/);
            
            if (isExtensionDevelopment) {
                console.log('Hover debug:', {
                    word,
                    wordRange,
                    wordEndIndex,
                    textUpToWordEnd,
                    attributeMatch,
                    lineText
                });
            }
            
            if (attributeMatch) {
                const objectName = attributeMatch[1];
                const attributeName = attributeMatch[2];
                
                // Get Python imports
                const pythonImports = pythonProvider.getImports(document);
                
                // First check if it's a module
                const pythonImport = pythonImports.find(imp => 
                    imp.alias === objectName || imp.name === objectName
                );
                
                if (isExtensionDevelopment) {
                    console.log('Python import check:', {
                        objectName,
                        attributeName,
                        pythonImport,
                        allImports: pythonImports
                    });
                }
                
                if (pythonImport) {
                    const actualModuleName = pythonImport.name;
                    
                    // Get Python signature asynchronously
                    const signature = await pythonProvider.getPythonSignature(actualModuleName, attributeName);
                    
                    if (isExtensionDevelopment) {
                        console.log('Got signature:', signature);
                    }
                    
                    if (signature) {
                        const markdown = new vscode.MarkdownString();
                        const lines = signature.split('\n');
                        
                        // First line is the signature
                        markdown.appendCodeblock(lines[0], 'python');
                        
                        // If there's a docstring, add it
                        if (lines.length > 1 && lines[1].startsWith('DOC:')) {
                            const docstring = lines[1].substring(4);
                            markdown.appendMarkdown('\n\n' + docstring);
                        }
                        
                        markdown.appendMarkdown(`\n\n📦 From module: \`${actualModuleName}\``);
                        return new vscode.Hover(markdown);
                    } else {
                        // Fallback when introspection fails
                        const markdown = new vscode.MarkdownString();
                        markdown.appendCodeblock(`${objectName}.${attributeName}`, 'python');
                        markdown.appendMarkdown(`\n\n📦 From Python module: \`${actualModuleName}\``);
                        markdown.appendMarkdown('\n\n_Note: Install the module to see full signature_');
                        return new vscode.Hover(markdown);
                    }
                } else {
                    // Check if it's a variable assigned from a Python class
                    const text = document.getText();
                    const varAssignPattern = new RegExp(`pyobj\\s+${objectName}\\s*=\\s*(\\w+)\\.(\\w+)\\s*\\(`, 'g');
                    const varMatch = varAssignPattern.exec(text);
                    
                    if (varMatch) {
                        const moduleName = varMatch[1];
                        const className = varMatch[2];
                        
                        // Find the Python module
                        const moduleImport = pythonImports.find(imp => 
                            imp.alias === moduleName || imp.name === moduleName
                        );
                        
                        if (moduleImport) {
                            // Get the attribute signature from the class
                            const signature = await pythonProvider.getPythonSignature(moduleImport.name, `${className}.${attributeName}`);
                            
                            if (signature) {
                                const markdown = new vscode.MarkdownString();
                                const lines = signature.split('\n');
                                
                                // First line is the signature
                                markdown.appendCodeblock(lines[0], 'python');
                                
                                // If there's a docstring, add it
                                if (lines.length > 1 && lines[1].startsWith('DOC:')) {
                                    const docstring = lines[1].substring(4);
                                    markdown.appendMarkdown('\n\n' + docstring);
                                }
                                
                                markdown.appendMarkdown(`\n\n📦 From class: \`${moduleImport.name}.${className}\``);
                                return new vscode.Hover(markdown);
                            }
                        }
                    }
                }
            }

            // Check Python imports (module names)
            const pythonImports = pythonProvider.getImports(document);
            const pythonImport = pythonImports.find(imp => 
                imp.name === word || imp.alias === word
            );
            if (pythonImport) {
                const markdown = new vscode.MarkdownString();
                const displayName = pythonImport.alias ? 
                    `${pythonImport.name} (as ${pythonImport.alias})` : 
                    pythonImport.name;
                markdown.appendCodeblock(`from python import ${displayName}`, 'frscript');
                markdown.appendMarkdown(`\n\n📦 **Python module**: \`${pythonImport.name}\``);
                return new vscode.Hover(markdown);
            }

            // Check types
            if (types.includes(word)) {
                return new vscode.Hover(new vscode.MarkdownString(`\`type: ${word}\``));
            }

            return undefined;
        }
    });

    // Signature help provider
    const signatureHelpProvider = vscode.languages.registerSignatureHelpProvider('frscript', {
        async provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position) {
            const lineText = document.lineAt(position.line).text;
            const textBeforeCursor = lineText.substring(0, position.character);

            // Check for Python module.function( pattern
            const pythonMatch = textBeforeCursor.match(/(\w+)\.(\w+)\s*\([^)]*$/);
            if (pythonMatch) {
                const moduleName = pythonMatch[1];
                const functionName = pythonMatch[2];
                
                // Check if it's a Python module
                const pythonImports = pythonProvider.getImports(document);
                const pythonImport = pythonImports.find(imp => 
                    imp.alias === moduleName || imp.name === moduleName
                );
                
                if (pythonImport) {
                    const signature = await pythonProvider.getPythonSignature(pythonImport.name, functionName);
                    
                    if (signature) {
                        const lines = signature.split('\n');
                        const signatureHelp = new vscode.SignatureHelp();
                        const sigInfo = new vscode.SignatureInformation(lines[0]);
                        
                        if (lines.length > 1 && lines[1].startsWith('DOC:')) {
                            sigInfo.documentation = new vscode.MarkdownString(lines[1].substring(4));
                        }
                        
                        signatureHelp.signatures = [sigInfo];
                        signatureHelp.activeSignature = 0;
                        signatureHelp.activeParameter = 0;
                        return signatureHelp;
                    }
                }
            }

            // Check for regular function calls
            const match = textBeforeCursor.match(/(\w+)\s*\([^)]*$/);
            if (!match) {
                return undefined;
            }

            const functionName = match[1];
            const func = builtinFunctions.find(f => f.name === functionName);

            if (func) {
                const signatureHelp = new vscode.SignatureHelp();
                const signature = new vscode.SignatureInformation(func.signature);
                signature.documentation = new vscode.MarkdownString(func.description);
                signatureHelp.signatures = [signature];
                signatureHelp.activeSignature = 0;
                signatureHelp.activeParameter = 0;
                return signatureHelp;
            }

            return undefined;
        }
    }, '(', ',');

    // Document symbols provider with docstrings
    const symbolProvider = vscode.languages.registerDocumentSymbolProvider('frscript', {
        provideDocumentSymbols(document: vscode.TextDocument) {
            const symbols: vscode.DocumentSymbol[] = [];
            const parsedSymbols = parseSymbols(document);

            parsedSymbols.forEach(symbol => {
                const line = document.lineAt(symbol.line);
                const kind = symbol.type === 'function' ? vscode.SymbolKind.Function : vscode.SymbolKind.Struct;

                const docSymbol = new vscode.DocumentSymbol(
                    symbol.name,
                    symbol.documentation || '',
                    kind,
                    line.range,
                    line.range
                );

                symbols.push(docSymbol);
            });

            return symbols;
        }
    });

    // 1. Go to Definition provider
    const definitionProvider = vscode.languages.registerDefinitionProvider('frscript', {
        provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
            const wordRange = document.getWordRangeAtPosition(position);
            const word = document.getText(wordRange);

            const symbols = parseSymbols(document);
            const symbol = symbols.find(s => s.name === word);

            if (symbol) {
                const line = document.lineAt(symbol.line);
                const startPos = line.text.indexOf(symbol.name);
                return new vscode.Location(
                    document.uri,
                    new vscode.Position(symbol.line, startPos)
                );
            }

            return undefined;
        }
    });

    // 2. Find All References provider
    const referenceProvider = vscode.languages.registerReferenceProvider('frscript', {
        provideReferences(document: vscode.TextDocument, position: vscode.Position, context) {
            const wordRange = document.getWordRangeAtPosition(position);
            const word = document.getText(wordRange);

            const locations: vscode.Location[] = [];
            const text = document.getText();
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            let match;

            while ((match = regex.exec(text)) !== null) {
                const pos = document.positionAt(match.index);
                locations.push(new vscode.Location(document.uri, pos));
            }

            return locations;
        }
    });

    // 3. Rename provider
    const renameProvider = vscode.languages.registerRenameProvider('frscript', {
        provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string) {
            const wordRange = document.getWordRangeAtPosition(position);
            const word = document.getText(wordRange);

            const edit = new vscode.WorkspaceEdit();
            const text = document.getText();
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            let match;

            while ((match = regex.exec(text)) !== null) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos, document.positionAt(match.index + word.length));
                edit.replace(document.uri, range, newName);
            }

            return edit;
        }
    });

    // Enhanced Code Actions provider with all features
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        'frscript',
        new EnhancedCodeActionProvider(pythonProvider),
        {
            providedCodeActionKinds: [
                vscode.CodeActionKind.QuickFix,
                vscode.CodeActionKind.Refactor,
                vscode.CodeActionKind.RefactorExtract,
                vscode.CodeActionKind.Source,
                vscode.CodeActionKind.SourceOrganizeImports
            ]
        }
    );

    // Remove old formatting provider - now handled by formatting.ts
    // 7. Formatting provider - REMOVED (handled by registerFormattingProviders)

    // 9. Semantic token provider (for better highlighting)
    const legend = new vscode.SemanticTokensLegend(
        ['function', 'variable', 'parameter', 'struct', 'property'],
        ['declaration', 'readonly', 'deprecated']
    );

    const semanticTokensProvider = vscode.languages.registerDocumentSemanticTokensProvider('frscript', {
        provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
            const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
            const symbols = parseSymbols(document);

            symbols.forEach(symbol => {
                const line = document.lineAt(symbol.line);
                const index = line.text.indexOf(symbol.name);

                if (index >= 0) {
                    let tokenType = 0;
                    if (symbol.type === 'function') {
                      tokenType = 0;
                    } else if (symbol.type === 'variable') {
                             tokenType = 1;
                           } else if (symbol.type === 'struct') {
                                    tokenType = 3;
                                  }

                    tokensBuilder.push(
                        new vscode.Range(symbol.line, index, symbol.line, index + symbol.name.length),
                        legend.tokenTypes[tokenType],
                        ['declaration']
                    );
                }
            });

            return tokensBuilder.build();
        }
    }, legend);

    // 10. Breadcrumb provider (via document symbols - already have this)

    // 11. Call Hierarchy provider
    const callHierarchyProvider = vscode.languages.registerCallHierarchyProvider('frscript', {
        prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position) {
            const wordRange = document.getWordRangeAtPosition(position);
            const word = document.getText(wordRange);

            const symbols = parseSymbols(document);
            const symbol = symbols.find(s => s.name === word && s.type === 'function');

            if (symbol) {
                const line = document.lineAt(symbol.line);
                return new vscode.CallHierarchyItem(
                    vscode.SymbolKind.Function,
                    symbol.name,
                    symbol.documentation || '',
                    document.uri,
                    line.range,
                    line.range
                );
            }

            return undefined;
        },

        provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem) {
            // Find what this function calls
            return [];
        },

        provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem) {
            // Find who calls this function
            return [];
        }
    });

    // 12. Folding range provider
    const foldingProvider = vscode.languages.registerFoldingRangeProvider('frscript', {
        provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
            const ranges: vscode.FoldingRange[] = [];
            const stack: number[] = [];

            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;

                if (line.includes('{')) {
                    stack.push(i);
                } else if (line.includes('}') && stack.length > 0) {
                    const start = stack.pop()!;
                    ranges.push(new vscode.FoldingRange(start, i));
                }

                // Support region comments
                if (line.match(/\/\/\s*region/)) {
                    stack.push(i);
                } else if (line.match(/\/\/\s*endregion/) && stack.length > 0) {
                    const start = stack.pop()!;
                    ranges.push(new vscode.FoldingRange(start, i, vscode.FoldingRangeKind.Region));
                }
            }

            return ranges;
        }
    });

    // 14. Inlay hints provider (parameter names)
    const inlayHintsProvider = vscode.languages.registerInlayHintsProvider('frscript', {
        provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
            const hints: vscode.InlayHint[] = [];
            const symbols = parseSymbols(document);
            const functions = symbols.filter(s => s.type === 'function');

            for (let i = range.start.line; i <= range.end.line; i++) {
                const line = document.lineAt(i);
                const {text} = line;

                // Skip function definitions (lines that start with a return type)
                if (text.match(/^\s*(void|int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj)\s+\w+\s*\(/)) {
                    continue;
                }

                // Match function calls only
                const funcCallRegex = /(\w+)\s*\(([^)]*)\)/g;
                let match;

                while ((match = funcCallRegex.exec(text)) !== null) {
                    const funcName = match[1];
                    const argsText = match[2];

                    const func = functions.find(f => f.name === funcName);
                    if (func && func.parameters && argsText.trim()) {
                        const args = argsText.split(',').map(a => a.trim());
                        let currentPos = match.index + funcName.length + 1;

                        args.forEach((arg, idx) => {
                            if (func.parameters && func.parameters[idx]) {
                                const param = func.parameters[idx];
                                const argStart = text.indexOf(arg, currentPos);

                                const hint = new vscode.InlayHint(
                                    new vscode.Position(i, argStart),
                                    `${param.name}: `,
                                    vscode.InlayHintKind.Parameter
                                );
                                hints.push(hint);
                                currentPos = argStart + arg.length;
                            }
                        });
                    }
                }
            }

            return hints;
        }
    });

    context.subscriptions.push(
        completionProvider,
        hoverProvider,
        signatureHelpProvider,
        symbolProvider,
        definitionProvider,
        referenceProvider,
        renameProvider,
        codeActionProvider,
        // formattingProvider removed - now handled by registerFormattingProviders
        semanticTokensProvider,
        callHierarchyProvider,
        foldingProvider,
        inlayHintsProvider
    );

    // Register all new commands
    context.subscriptions.push(
        ...documentationProvider.createCommands(),
        ...refactoringProvider.createCommands(),
        ...dependencyManager.createCommands(),
        createOrganizeImportsCommand(),
        createSortMembersCommand(),
        createRunCurrentFileCommand(),
        createBuildCurrentFileCommand(),
        createFindSymbolCommand(),
        createInsertColorCommand(),
        vscode.commands.registerCommand('frscript.showMetrics', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'frscript') {
                metricsProvider.showMetricsReport(editor.document);
            }
        })
    );

    // Debug configuration provider
    const debugConfigProvider = vscode.debug.registerDebugConfigurationProvider('frscript', {
        resolveDebugConfiguration(
            folder: vscode.WorkspaceFolder | undefined,
            config: vscode.DebugConfiguration,
            token?: vscode.CancellationToken
        ): vscode.ProviderResult<vscode.DebugConfiguration> {

            debugOutputChannel.appendLine('=== Debug Session Starting ===');
            debugOutputChannel.appendLine(`Resolving debug configuration: ${JSON.stringify(config)}`);

            // If launch.json is missing or empty
            if (!config.type && !config.request && !config.name) {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document.languageId === 'frscript') {
                    config.type = 'frscript';
                    config.name = 'Debug Frscript';
                    config.request = 'launch';
                    config.program = '${file}';
                    config.stopOnEntry = true;
                    debugOutputChannel.appendLine('Created default debug configuration');
                }
            }

            if (!config.program) {
                debugOutputChannel.appendLine('ERROR: No program specified!');
                return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
                    return undefined;
                });
            }

            debugOutputChannel.appendLine(`Final config: ${JSON.stringify(config)}`);
            return config;
        }
    });

    // Inline debug adapter factory to share output channel (lazy load to avoid import errors)
    const debugAdapterFactory = vscode.debug.registerDebugAdapterDescriptorFactory('frscript', {
        createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
            debugOutputChannel.appendLine(`Creating debug adapter for session: ${session.name}`);
            debugOutputChannel.show(true); // Show the output channel

            // Lazy load the debug adapter only when needed
            try {
                const { FrscriptDebugSession } = require('./debugAdapter');
                return new vscode.DebugAdapterInlineImplementation(new FrscriptDebugSession());
            } catch (error) {
                debugOutputChannel.appendLine(`ERROR: Failed to load debug adapter: ${error}`);
                vscode.window.showErrorMessage(`Failed to load Frscript debug adapter: ${error}`);
                return undefined;
            }
        }
    });

    context.subscriptions.push(debugConfigProvider, debugAdapterFactory);
}

export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
