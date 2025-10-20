import * as vscode from 'vscode';

export interface FrscriptConfig {
    formatting: {
        indentSize: number;
        insertSpaces: boolean;
    };
    linting: {
        enabled: boolean;
        unusedVariables: 'error' | 'warning' | 'hint';
        unusedImports: 'error' | 'warning' | 'hint';
    };
    metrics: {
        enabled: boolean;
        maxComplexity: number;
        maxFunctionLength: number;
        maxNestingDepth: number;
    };
    python: {
        validateImports: boolean;
        suggestImports: boolean;
    };
    debug: {
        enableConsole: boolean;
        showVariableTypes: boolean;
    };
    documentation: {
        autoGenerate: boolean;
        includeExamples: boolean;
    };
}

export function getConfig(): FrscriptConfig {
    const config = vscode.workspace.getConfiguration('frscript');
    
    return {
        formatting: {
            indentSize: config.get('formatting.indentSize', 4),
            insertSpaces: config.get('formatting.insertSpaces', true),
        },
        linting: {
            enabled: config.get('linting.enabled', true),
            unusedVariables: config.get('linting.unusedVariables', 'warning'),
            unusedImports: config.get('linting.unusedImports', 'warning'),
        },
        metrics: {
            enabled: config.get('metrics.enabled', true),
            maxComplexity: config.get('metrics.maxComplexity', 10),
            maxFunctionLength: config.get('metrics.maxFunctionLength', 50),
            maxNestingDepth: config.get('metrics.maxNestingDepth', 4),
        },
        python: {
            validateImports: config.get('python.validateImports', true),
            suggestImports: config.get('python.suggestImports', true),
        },
        debug: {
            enableConsole: config.get('debug.enableConsole', true),
            showVariableTypes: config.get('debug.showVariableTypes', true),
        },
        documentation: {
            autoGenerate: config.get('documentation.autoGenerate', false),
            includeExamples: config.get('documentation.includeExamples', true),
        },
    };
}

export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;
    
    return function(...args: Parameters<T>) {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => func(...args), wait);
    };
}

export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isInsideString(document: vscode.TextDocument, position: vscode.Position): boolean {
    const line = document.lineAt(position.line).text;
    const charsBefore = line.substring(0, position.character);
    
    // Handle f-strings: f"text" or f'text'
    // Count quotes, but skip escaped quotes
    let inDoubleQuote = false;
    let inSingleQuote = false;
    let inFString = false;
    let inFStringBrace = false;
    
    for (let i = 0; i < charsBefore.length; i++) {
        const char = charsBefore[i];
        const prevChar = i > 0 ? charsBefore[i - 1] : '';
        
        // Skip escaped characters
        if (prevChar === '\\') {
            continue;
        }
        
        // Check for f-string start
        if (char === 'f' && i + 1 < charsBefore.length) {
            const nextChar = charsBefore[i + 1];
            if (nextChar === '"' || nextChar === "'") {
                inFString = true;
                i++; // Skip the quote
                if (nextChar === '"') {
                    inDoubleQuote = true;
                } else {
                    inSingleQuote = true;
                }
                continue;
            }
        }
        
        // Handle braces in f-strings
        if (inFString && (inDoubleQuote || inSingleQuote)) {
            if (char === '{') {
                inFStringBrace = true;
            } else if (char === '}') {
                inFStringBrace = false;
            }
        }
        
        // Toggle quote state (but not inside f-string braces)
        if (!inFStringBrace) {
            if (char === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                if (!inDoubleQuote) {
                    inFString = false;
                }
            } else if (char === "'" && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                if (!inSingleQuote) {
                    inFString = false;
                }
            }
        }
    }
    
    // Inside string if we're in quotes and not inside f-string braces
    return (inDoubleQuote || inSingleQuote) && !inFStringBrace;
}

export function isInsideComment(document: vscode.TextDocument, position: vscode.Position): boolean {
    const line = document.lineAt(position.line).text;
    const charsBefore = line.substring(0, position.character);
    
    return charsBefore.includes('//');
}

export function extractPythonImports(document: vscode.TextDocument): Map<string, { module: string; alias?: string; line: number }> {
    const imports = new Map<string, { module: string; alias?: string; line: number }>();
    
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();
        
        // py_import module
        const simpleImport = line.match(/^py_import\s+(\w+)(?:\s+as\s+(\w+))?/);
        if (simpleImport) {
            const module = simpleImport[1];
            const alias = simpleImport[2];
            const key = alias || module;
            imports.set(key, { module, alias, line: i });
        }
        
        // from module py_import name
        const fromImport = line.match(/^from\s+(\w+)\s+py_import\s+(\w+)(?:\s+as\s+(\w+))?/);
        if (fromImport) {
            const module = fromImport[1];
            const name = fromImport[2];
            const alias = fromImport[3];
            const key = alias || name;
            imports.set(key, { module: `${module}.${name}`, alias, line: i });
        }
    }
    
    return imports;
}

export function calculateComplexity(document: vscode.TextDocument, startLine: number, endLine: number): number {
    let complexity = 1; // Base complexity
    
    for (let i = startLine; i <= endLine; i++) {
        const line = document.lineAt(i).text;
        
        // Skip comments
        if (isInsideComment(document, new vscode.Position(i, 0))) {
            continue;
        }
        
        // Remove string content to avoid counting control keywords inside strings
        const cleanedLine = removeStringsFromLine(line);
        
        // Control flow statements add complexity
        if (cleanedLine.match(/\b(if|elif|while|for|switch|case)\b/)) {
            complexity++;
        }
        
        // Logical operators add complexity (but not inside strings)
        complexity += (cleanedLine.match(/&&|\|\|/g) || []).length;
    }
    
    return complexity;
}

function removeStringsFromLine(line: string): string {
    // Remove all string content including f-strings
    // This helps avoid counting keywords/operators inside strings
    let result = '';
    let inString = false;
    let stringChar = '';
    let inFString = false;
    let braceDepth = 0;
    let escaped = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const prevChar = i > 0 ? line[i - 1] : '';
        const nextChar = i + 1 < line.length ? line[i + 1] : '';
        
        if (escaped) {
            escaped = false;
            continue;
        }
        
        if (char === '\\') {
            escaped = true;
            continue;
        }
        
        // Check for f-string start
        if (!inString && char === 'f' && (nextChar === '"' || nextChar === "'")) {
            inString = true;
            inFString = true;
            stringChar = nextChar;
            i++; // Skip the quote
            continue;
        }
        
        // Regular string start/end
        if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
            inFString = false;
            continue;
        }
        
        if (inString && char === stringChar && braceDepth === 0) {
            inString = false;
            inFString = false;
            continue;
        }
        
        // Track braces in f-strings (code inside braces should be counted)
        if (inFString) {
            if (char === '{') {
                braceDepth++;
                if (braceDepth === 1) {
                    continue; // Skip the opening brace itself
                }
            } else if (char === '}') {
                braceDepth--;
                if (braceDepth === 0) {
                    continue; // Skip the closing brace itself
                }
            }
            
            // If we're inside braces, include the content
            if (braceDepth > 0) {
                result += char;
                continue;
            }
        }
        
        // Skip content inside regular strings
        if (inString) {
            continue;
        }
        
        result += char;
    }
    
    return result;
}

export function calculateNestingDepth(document: vscode.TextDocument, startLine: number, endLine: number): number {
    let maxDepth = 0;
    let currentDepth = 0;
    
    for (let i = startLine; i <= endLine; i++) {
        const line = document.lineAt(i).text;
        
        // Remove strings to avoid counting braces inside strings/f-strings
        const cleanedLine = removeStringsFromLine(line);
        
        currentDepth += (cleanedLine.match(/{/g) || []).length;
        maxDepth = Math.max(maxDepth, currentDepth);
        currentDepth -= (cleanedLine.match(/}/g) || []).length;
    }
    
    return maxDepth;
}

export function findFunctionBody(document: vscode.TextDocument, functionLine: number): { start: number; end: number } | null {
    let braceCount = 0;
    let foundStart = false;
    let startLine = functionLine;
    let endLine = functionLine;
    
    for (let i = functionLine; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        
        // Remove string content to avoid counting braces inside strings/f-strings
        const cleanedLine = removeStringsFromLine(line);
        
        for (const char of cleanedLine) {
            if (char === '{') {
                braceCount++;
                foundStart = true;
            } else if (char === '}') {
                braceCount--;
                if (foundStart && braceCount === 0) {
                    endLine = i;
                    return { start: startLine, end: endLine };
                }
            }
        }
    }
    
    return null;
}

export function getIndentLevel(line: string): number {
    const match = line.match(/^(\s*)/);
    if (!match) {
      return 0;
    }

    const spaces = match[1].length;
    return Math.floor(spaces / 4); // Assuming 4 spaces per indent
}

export function createIndent(level: number, useSpaces: boolean = true, indentSize: number = 4): string {
    if (useSpaces) {
        return ' '.repeat(level * indentSize);
    }
    return '\t'.repeat(level);
}
