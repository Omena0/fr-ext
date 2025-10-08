import * as vscode from 'vscode';
import { calculateComplexity, calculateNestingDepth, findFunctionBody, getConfig } from './utils';

export interface CodeMetrics {
    complexity: number;
    functionLength: number;
    nestingDepth: number;
}

export interface FunctionMetrics extends CodeMetrics {
    name: string;
    line: number;
}

export class MetricsProvider {
    private metricsCache: Map<string, FunctionMetrics[]> = new Map();
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'frscript.showMetrics';
    }

    public calculateFileMetrics(document: vscode.TextDocument): FunctionMetrics[] {
        const metrics: FunctionMetrics[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const {text} = line;

            // Match function declarations
            const funcMatch = text.match(/^\s*(void|int|float|str|bool|list|dict|any|pyobject)\s+(\w+)\s*\(/);
            if (funcMatch) {
                const functionName = funcMatch[2];
                const body = findFunctionBody(document, i);

                if (body) {
                    const complexity = calculateComplexity(document, body.start, body.end);
                    const functionLength = body.end - body.start + 1;
                    const nestingDepth = calculateNestingDepth(document, body.start, body.end);

                    metrics.push({
                        name: functionName,
                        line: i,
                        complexity,
                        functionLength,
                        nestingDepth,
                    });
                }
            }
        }

        this.metricsCache.set(document.uri.toString(), metrics);
        return metrics;
    }

    public updateStatusBar(document: vscode.TextDocument, position: vscode.Position) {
        const config = getConfig();
        
        if (!config.metrics.enabled) {
            this.statusBarItem.hide();
            return;
        }

        const metrics = this.calculateFileMetrics(document);
        
        // Find metrics for the current function
        const currentMetrics = metrics.find(m => {
            const body = findFunctionBody(document, m.line);
            return body && position.line >= body.start && position.line <= body.end;
        });

        if (currentMetrics) {
            const complexityIcon = currentMetrics.complexity > config.metrics.maxComplexity ? '⚠️' : '✓';
            const lengthIcon = currentMetrics.functionLength > config.metrics.maxFunctionLength ? '⚠️' : '✓';
            const depthIcon = currentMetrics.nestingDepth > config.metrics.maxNestingDepth ? '⚠️' : '✓';

            this.statusBarItem.text = `$(symbol-method) ${currentMetrics.name} | ` +
                `${complexityIcon} CC: ${currentMetrics.complexity} | ` +
                `${lengthIcon} Len: ${currentMetrics.functionLength} | ` +
                `${depthIcon} Depth: ${currentMetrics.nestingDepth}`;
            this.statusBarItem.tooltip = 'Function Metrics:\n' +
                `Cyclomatic Complexity: ${currentMetrics.complexity}\n` +
                `Function Length: ${currentMetrics.functionLength} lines\n` +
                `Max Nesting Depth: ${currentMetrics.nestingDepth}`;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    public createMetricsDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const config = getConfig();

        if (!config.metrics.enabled) {
            return diagnostics;
        }

        const metrics = this.calculateFileMetrics(document);

        metrics.forEach(metric => {
            const line = document.lineAt(metric.line);
            const nameIndex = line.text.indexOf(metric.name);
            const range = new vscode.Range(metric.line, nameIndex, metric.line, nameIndex + metric.name.length);

            // Check complexity
            if (metric.complexity > config.metrics.maxComplexity) {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Function '${metric.name}' has high cyclomatic complexity (${metric.complexity}). ` +
                    `Consider refactoring to reduce complexity below ${config.metrics.maxComplexity}.`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.code = 'high-complexity';
                diagnostic.source = 'frscript-metrics';
                diagnostics.push(diagnostic);
            }

            // Check function length
            if (metric.functionLength > config.metrics.maxFunctionLength) {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Function '${metric.name}' is too long (${metric.functionLength} lines). ` +
                    `Consider splitting into smaller functions (max: ${config.metrics.maxFunctionLength} lines).`,
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.code = 'long-function';
                diagnostic.source = 'frscript-metrics';
                diagnostics.push(diagnostic);
            }

            // Check nesting depth
            if (metric.nestingDepth > config.metrics.maxNestingDepth) {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Function '${metric.name}' has deep nesting (${metric.nestingDepth} levels). ` +
                    `Consider reducing nesting below ${config.metrics.maxNestingDepth} levels.`,
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.code = 'deep-nesting';
                diagnostic.source = 'frscript-metrics';
                diagnostics.push(diagnostic);
            }
        });

        return diagnostics;
    }

    public showMetricsReport(document: vscode.TextDocument) {
        const metrics = this.calculateFileMetrics(document);
        
        const panel = vscode.window.createWebviewPanel(
            'frscriptMetrics',
            'Frscript Code Metrics',
            vscode.ViewColumn.Beside,
            {}
        );

        let totalComplexity = 0;
        let totalLines = 0;
        let maxDepth = 0;

        metrics.forEach(m => {
            totalComplexity += m.complexity;
            totalLines += m.functionLength;
            maxDepth = Math.max(maxDepth, m.nestingDepth);
        });

        const avgComplexity = metrics.length > 0 ? (totalComplexity / metrics.length).toFixed(2) : '0';

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-foreground);
                    }
                    h1 { color: var(--vscode-textLink-foreground); }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin: 20px 0;
                    }
                    th, td {
                        padding: 12px;
                        text-align: left;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    th {
                        background: var(--vscode-editor-background);
                        font-weight: bold;
                    }
                    .warning { color: var(--vscode-editorWarning-foreground); }
                    .good { color: var(--vscode-terminal-ansiGreen); }
                    .summary {
                        background: var(--vscode-editor-background);
                        padding: 15px;
                        border-radius: 5px;
                        margin: 20px 0;
                    }
                </style>
            </head>
            <body>
                <h1>📊 Code Metrics Report</h1>
                <div class="summary">
                    <h2>Summary</h2>
                    <p><strong>Total Functions:</strong> ${metrics.length}</p>
                    <p><strong>Average Complexity:</strong> ${avgComplexity}</p>
                    <p><strong>Total Lines:</strong> ${totalLines}</p>
                    <p><strong>Max Nesting Depth:</strong> ${maxDepth}</p>
                </div>
                <h2>Function Details</h2>
                <table>
                    <tr>
                        <th>Function</th>
                        <th>Complexity</th>
                        <th>Length</th>
                        <th>Nesting</th>
                        <th>Line</th>
                    </tr>
                    ${metrics.map(m => `
                        <tr>
                            <td><strong>${m.name}</strong></td>
                            <td class="${m.complexity > 10 ? 'warning' : 'good'}">${m.complexity}</td>
                            <td class="${m.functionLength > 50 ? 'warning' : 'good'}">${m.functionLength}</td>
                            <td class="${m.nestingDepth > 4 ? 'warning' : 'good'}">${m.nestingDepth}</td>
                            <td>${m.line + 1}</td>
                        </tr>
                    `).join('')}
                </table>
            </body>
            </html>
        `;

        panel.webview.html = html;
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
