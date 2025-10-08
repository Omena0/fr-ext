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
    
    const doubleQuotes = (charsBefore.match(/"/g) || []).length;
    const singleQuotes = (charsBefore.match(/'/g) || []).length;
    
    return (doubleQuotes % 2 !== 0) || (singleQuotes % 2 !== 0);
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
        
        // Control flow statements add complexity
        if (line.match(/\b(if|elif|while|for|switch|case)\b/)) {
            complexity++;
        }
        
        // Logical operators add complexity
        complexity += (line.match(/&&|\|\|/g) || []).length;
    }
    
    return complexity;
}

export function calculateNestingDepth(document: vscode.TextDocument, startLine: number, endLine: number): number {
    let maxDepth = 0;
    let currentDepth = 0;
    
    for (let i = startLine; i <= endLine; i++) {
        const line = document.lineAt(i).text;
        
        currentDepth += (line.match(/{/g) || []).length;
        maxDepth = Math.max(maxDepth, currentDepth);
        currentDepth -= (line.match(/}/g) || []).length;
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
        
        for (const char of line) {
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
