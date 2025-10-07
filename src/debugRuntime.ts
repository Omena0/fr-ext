import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export enum RuntimeEvents {
    stopOnEntry = 'stopOnEntry',
    stopOnStep = 'stopOnStep',
    stopOnBreakpoint = 'stopOnBreakpoint',
    stopOnException = 'stopOnException',
    breakpointValidated = 'breakpointValidated',
    output = 'output',
    end = 'end'
}

interface Breakpoint {
    id: number;
    line: number;
    verified: boolean;
}

interface StackFrameData {
    index: number;
    name: string;
    file: string;
    line: number;
}

export class FrscriptRuntime extends EventEmitter {
    private sourceFile: string = '';
    private debugProcess: ChildProcess | null = null;
    private breakpoints = new Map<string, Breakpoint[]>();
    private breakpointId = 1;
    
    // Runtime state
    private currentLine = 0;
    private currentFile = '';
    private callStack: StackFrameData[] = [];
    private variables: { local: any, global: any } = { local: {}, global: {} };
    private stepMode: 'in' | 'over' | 'out' | null = null;
    private stepDepth = 0;
    private stopOnEntry = false;
    private isPaused = false;
    private isRunning = false;
    private tracing = false;
    private logFile: string;

    constructor() {
        super();
        this.logFile = `/tmp/frscript-debug-${Date.now()}.log`;
        this.log('FrscriptRuntime initialized');
    }

    public log(message: string): void {
        const fs = require('fs');
        try {
            fs.appendFileSync(this.logFile, `[${new Date().toISOString()}] ${message}\n`);
        } catch (e) {
            // Ignore log errors
        }
        
        // Also log to output channel
        try {
            const outputChannel = (global as any).frscriptDebugOutput;
            if (outputChannel) {
                const timestamp = new Date().toISOString();
                outputChannel.appendLine(`[${timestamp}] [Runtime] ${message}`);
            }
        } catch (e) {
            // Ignore if output channel not available
        }
    }

    public enableTracing(): void {
        this.tracing = true;
    }

    public async start(program: string, stopOnEntry: boolean): Promise<void> {
        this.log(`Starting debugger for: ${program}`);
        
        this.sourceFile = program;
        this.currentFile = program;
        this.isRunning = true;
        this.stopOnEntry = stopOnEntry;  // Store for later use

        // Don't emit stopOnEntry here - wait for the debug process to send pausing_on_entry
        // The debug process will handle the pause
    }
    
    public configurationComplete(): void {
        this.log('Configuration complete, starting debug process');
        // Always start the debug process when configuration is complete
        if (!this.debugProcess) {
            this.startDebugProcess();
        }
    }

    public continue(): void {
        this.isPaused = false;
        this.stepMode = null;
        
        if (!this.debugProcess) {
            this.startDebugProcess();
        } else {
            this.sendCommand('continue');
        }
    }

    public step(): void {
        this.stepMode = 'over';
        this.sendCommand('step');
    }

    public stepIn(): void {
        this.stepMode = 'in';
        this.sendCommand('stepIn');
    }

    public stepOut(): void {
        this.stepMode = 'out';
        this.sendCommand('stepOut');
    }

    public pause(): void {
        this.isPaused = true;
        this.sendCommand('pause');
    }

    public stop(): void {
        this.isRunning = false;
        if (this.debugProcess) {
            this.debugProcess.kill();
            this.debugProcess = null;
        }
    }

    public setBreakPoint(file: string, line: number): { verified: boolean; line: number; id: number } {
        const bp: Breakpoint = { verified: true, line, id: this.breakpointId++ };
        
        let bps = this.breakpoints.get(file);
        if (!bps) {
            bps = [];
            this.breakpoints.set(file, bps);
        }
        bps.push(bp);

        this.emit(RuntimeEvents.breakpointValidated, bp);
        
        if (this.debugProcess) {
            this.sendCommand(`breakpoint:${file}:${line}`);
        }

        return bp;
    }

    public clearBreakpoints(file: string): void {
        this.breakpoints.delete(file);
        if (this.debugProcess) {
            this.sendCommand(`clearBreakpoints:${file}`);
        }
    }

    public stack(startFrame: number, endFrame: number): { frames: StackFrameData[]; count: number } {
        const frames = this.callStack.slice(startFrame, endFrame);
        return {
            frames: frames,
            count: this.callStack.length
        };
    }

    public getVariables(scope: string): any {
        if (scope === 'local') {
            return this.variables.local;
        } else if (scope === 'global') {
            return this.variables.global;
        } else if (scope.startsWith('struct:')) {
            // Handle struct field access
            const parts = scope.split(':');
            const structName = parts[1];
            return this.variables.local[structName] || this.variables.global[structName] || {};
        }
        return {};
    }

    public evaluate(expression: string, isHover: boolean): any {
        this.log(`Evaluating expression: ${expression}`);
        
        // Check local variables first
        if (this.variables.local.hasOwnProperty(expression)) {
            this.log(`Found in local variables: ${expression}`);
            return this.variables.local[expression];
        }
        // Then check global variables
        if (this.variables.global.hasOwnProperty(expression)) {
            this.log(`Found in global variables: ${expression}`);
            return this.variables.global[expression];
        }
        
        // Check for literal values
        // String literals
        if ((expression.startsWith('"') && expression.endsWith('"')) || 
            (expression.startsWith("'") && expression.endsWith("'"))) {
            return expression.slice(1, -1);
        }
        
        // Number literals
        const num = Number(expression);
        if (!isNaN(num)) {
            return num;
        }
        
        // Boolean literals
        if (expression === 'true') return true;
        if (expression === 'false') return false;
        
        // List literals
        if (expression.startsWith('[') && expression.endsWith(']')) {
            try {
                return JSON.parse(expression);
            } catch {
                // Invalid list literal
            }
        }
        
        // Send evaluate command to debug process for complex expressions
        if (this.debugProcess) {
            this.sendCommand(`evaluate:${expression}`);
            // Note: This is async and won't return the result immediately
            // The debug protocol would need to handle the response
        }
        
        throw new Error(`Cannot evaluate '${expression}' - not a variable or literal value. Complex expressions require debugger support.`);
    }

    public setVariable(scope: string, name: string, value: string): any {
        let parsedValue: any;
        try {
            parsedValue = JSON.parse(value);
        } catch {
            parsedValue = value;
        }

        if (scope === 'local') {
            this.variables.local[name] = parsedValue;
        } else if (scope === 'global') {
            this.variables.global[name] = parsedValue;
        }

        if (this.debugProcess) {
            this.sendCommand(`setVar:${scope}:${name}:${value}`);
        }

        return parsedValue;
    }

    private startDebugProcess(): void {
        this.log('Starting debug process');
        
        const fs = require('fs');
        const os = require('os');
        
        // Look for 'fr' in common locations
        const possiblePaths = [
            `${os.homedir()}/.local/bin/fr`,
            '/usr/local/bin/fr',
            '/usr/bin/fr',
        ];
        
        let command: string | null = null;
        let args: string[];
        
        // Check if fr exists in any of the common paths
        for (const frPath of possiblePaths) {
            try {
                if (fs.existsSync(frPath)) {
                    command = frPath;
                    this.log(`Found fr at: ${frPath}`);
                    break;
                }
            } catch (e) {
                // Continue checking
            }
        }
        
        if (!command) {
            // 'fr' command not found
            const errorMsg = 
                '\nFrscript Debugger Error: Command "fr" not found\n\n' +
                'The debugger requires Frscript to be installed globally.\n\n' +
                'Install with: pipx install -e ' + path.dirname(path.dirname(__dirname)) + '\n' +
                'Then restart VS Code.\n';
            
            this.emit(RuntimeEvents.output, errorMsg, 'stderr');
            this.emit(RuntimeEvents.end);
            return;
        }
        
        args = [this.sourceFile, '--debug'];
        
        // Start the debug process with special debug flag
        try {
            this.log(`Spawning: ${command} ${args.join(' ')}`);
            
            this.debugProcess = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            this.log(`Debug process started (PID: ${this.debugProcess.pid})`);
        } catch (err) {
            this.log(`Failed to spawn: ${err}`);
            const errorMsg = `Failed to start debug process: ${err}\n`;
            this.emit(RuntimeEvents.output, errorMsg, 'stderr');
            this.emit(RuntimeEvents.end);
            return;
        }

        if (!this.debugProcess.stdout || !this.debugProcess.stderr || !this.debugProcess.stdin) {
            throw new Error('Failed to create debug process streams');
        }

        // Send stopOnEntry flag if set
        if (this.stopOnEntry) {
            this.sendCommand('stopOnEntry');
        }

        // Send initial breakpoints
        for (const [file, bps] of this.breakpoints.entries()) {
            for (const bp of bps) {
                this.sendCommand(`breakpoint:${file}:${bp.line}`);
            }
        }

        let outputBuffer = '';

        this.debugProcess.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            outputBuffer += text;

            // Check for debug protocol messages
            const lines = outputBuffer.split('\n');
            outputBuffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('DEBUG:')) {
                    this.handleDebugMessage(line.substring(6));
                } else {
                    this.emit(RuntimeEvents.output, line + '\n', 'stdout');
                }
            }
        });

        this.debugProcess.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            this.log(`stderr: ${text}`);
            this.emit(RuntimeEvents.output, text, 'stderr');
            
            // Check for errors
            if (text.includes('Error') || text.includes('Exception') || text.includes('Traceback')) {
                this.log(`Exception detected: ${text}`);
                this.emit(RuntimeEvents.stopOnException, text);
            }
        });

        this.debugProcess.on('exit', (code: number | null) => {
            this.log(`Debug process exited with code ${code}`);
            const exitMsg = code !== 0 && code !== null 
                ? `Debug process exited with code ${code}\n`
                : '';
            if (exitMsg) {
                this.emit(RuntimeEvents.output, exitMsg, 'stderr');
            }
            this.debugProcess = null;
            this.isRunning = false;
            this.emit(RuntimeEvents.end);
        });
        
        this.debugProcess.on('error', (err: Error) => {
            this.log(`Debug process error: ${err.message}`);
            this.emit(RuntimeEvents.output, `Debug process error: ${err.message}\n`, 'stderr');
            this.emit(RuntimeEvents.end);
        });
    }

    private handleDebugMessage(message: string): void {
        // Log all debug messages to output
        this.emit(RuntimeEvents.output, `[Debug] ${message}\n`, 'console');
        
        if (this.tracing) {
            console.log('Debug message:', message);
        }

        const parts = message.split(':');
        const type = parts[0];

        switch (type) {
            case 'line':
                this.currentLine = parseInt(parts[1]);
                this.updateStackFrame();
                // Don't emit stop events here - wait for pausing_* messages
                break;

            case 'pausing_on_entry':
                this.currentLine = parseInt(parts[1]);
                this.updateStackFrame();
                this.emit(RuntimeEvents.stopOnEntry);
                break;

            case 'pausing_at_breakpoint':
                this.currentLine = parseInt(parts[1]);
                this.updateStackFrame();
                this.emit(RuntimeEvents.stopOnBreakpoint);
                break;

            case 'pausing_on_step':
                this.currentLine = parseInt(parts[1]);
                this.updateStackFrame();
                this.emit(RuntimeEvents.stopOnStep);
                break;

            case 'call':
                const funcName = parts[1];
                this.callStack.push({
                    index: this.callStack.length,
                    name: funcName,
                    file: this.currentFile,
                    line: 0  // Line will be set by next line: message
                });
                break;

            case 'return':
                this.callStack.pop();
                break;

            case 'vars':
                // Parse variable data: vars:scope:json_data
                const scope = parts[1];
                const varData = parts.slice(2).join(':');
                try {
                    const vars = JSON.parse(varData);
                    if (scope === 'local') {
                        this.variables.local = vars;
                    } else if (scope === 'global') {
                        this.variables.global = vars;
                    }
                } catch (e) {
                    console.error('Failed to parse variables:', e);
                }
                break;

            case 'error':
                this.emit(RuntimeEvents.stopOnException, parts.slice(1).join(':'));
                break;
        }
    }

    private shouldStopAtLine(line: number): boolean {
        const bps = this.breakpoints.get(this.currentFile);
        if (bps) {
            return bps.some(bp => bp.line === line && bp.verified);
        }
        return false;
    }

    private updateStackFrame(): void {
        // Only update existing frames, don't create new ones
        // Frames are created by 'call:' messages
        if (this.callStack.length > 0) {
            this.callStack[this.callStack.length - 1].line = this.currentLine;
        }
    }

    private sendCommand(command: string): void {
        if (this.debugProcess && this.debugProcess.stdin) {
            this.debugProcess.stdin.write(command + '\n');
            this.emit(RuntimeEvents.output, `[Debug Command] ${command}\n`, 'console');
        }
    }

    private findFrCommand(): string {
        // Try to find the fr CLI
        const possiblePaths = [
            path.join(__dirname, '../../src/cli.py'),
            path.join(__dirname, '../../../src/cli.py'),
            '/usr/local/bin/fr',
            '/usr/bin/fr'
        ];

        const fs = require('fs');
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }

        throw new Error('Could not find Frscript CLI. Please ensure it is installed.');
    }
}
