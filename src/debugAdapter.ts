import {
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
    Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { FrscriptRuntime, RuntimeEvents } from './debugRuntime';
import * as path from 'path';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    stopOnEntry?: boolean;
    trace?: boolean;
}

export class FrscriptDebugSession extends LoggingDebugSession {
    private static THREAD_ID = 1;
    private runtime: FrscriptRuntime;
    private variableHandles = new Handles<string>();
    private configurationDone = false;

    public constructor() {
        super("frscript-debug");
        
        this.logToOutput('FrscriptDebugSession constructor called');
        
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);

        this.runtime = new FrscriptRuntime();

        // Setup runtime event handlers
        this.runtime.on(RuntimeEvents.stopOnEntry, () => {
            this.logToOutput('Event: stopOnEntry');
            this.sendEvent(new StoppedEvent('entry', FrscriptDebugSession.THREAD_ID));
        });

        this.runtime.on(RuntimeEvents.stopOnStep, () => {
            this.logToOutput('Event: stopOnStep');
            this.sendEvent(new StoppedEvent('step', FrscriptDebugSession.THREAD_ID));
        });

        this.runtime.on(RuntimeEvents.stopOnBreakpoint, () => {
            this.logToOutput('Event: stopOnBreakpoint');
            this.sendEvent(new StoppedEvent('breakpoint', FrscriptDebugSession.THREAD_ID));
        });

        this.runtime.on(RuntimeEvents.stopOnException, (error: string) => {
            this.logToOutput(`Event: stopOnException - ${error}`);
            this.sendEvent(new StoppedEvent('exception', FrscriptDebugSession.THREAD_ID, error));
        });

        this.runtime.on(RuntimeEvents.breakpointValidated, (bp: { id: number; line: number; verified: boolean }) => {
            this.logToOutput(`Event: breakpointValidated - line ${bp.line}, id ${bp.id}`);
            this.sendEvent(new BreakpointEvent('changed', { verified: bp.verified, id: bp.id } as DebugProtocol.Breakpoint));
        });

        this.runtime.on(RuntimeEvents.output, (text: string, category?: string) => {
            this.logToOutput(`Output (${category || 'stdout'}): ${text}`);
            this.sendEvent(new OutputEvent(text, category || 'stdout'));
        });

        this.runtime.on(RuntimeEvents.end, () => {
            this.logToOutput('Event: end - sending TerminatedEvent');
            this.sendEvent(new TerminatedEvent());
        });
        
        this.logToOutput('FrscriptDebugSession constructor completed');
    }

    private logToOutput(message: string): void {
        try {
            const outputChannel = (global as any).frscriptDebugOutput;
            if (outputChannel) {
                const timestamp = new Date().toISOString();
                outputChannel.appendLine(`[${timestamp}] ${message}`);
            }
        } catch (e) {
            // Silently fail if output channel not available
        }
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        this.logToOutput('initializeRequest called');
        
        response.body = response.body || {};

        // Capabilities
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        response.body.supportsDataBreakpoints = false;
        response.body.supportsCompletionsRequest = false;
        response.body.supportsCancelRequest = false;
        response.body.supportsBreakpointLocationsRequest = false;
        response.body.supportsStepInTargetsRequest = false;
        response.body.supportsExceptionFilterOptions = true;
        response.body.exceptionBreakpointFilters = [
            {
                filter: 'exceptions',
                label: 'Caught Exceptions',
                default: false
            }
        ];
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsHitConditionalBreakpoints = false;
        response.body.supportsFunctionBreakpoints = false;
        response.body.supportsSetVariable = true;
        response.body.supportsSetExpression = false;
        response.body.supportsDisassembleRequest = false;
        response.body.supportsClipboardContext = false;
        response.body.supportsValueFormattingOptions = false;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
        this.logToOutput('initializeRequest completed');
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        this.logToOutput('configurationDoneRequest called');
        super.configurationDoneRequest(response, args);
        this.configurationDone = true;
        
        // Start execution after configuration is done
        this.runtime.configurationComplete();
        this.logToOutput('configurationDoneRequest completed');
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        this.logToOutput(`launchRequest called with program: ${args.program}, stopOnEntry: ${args.stopOnEntry}`);
        
        try {
            if (args.trace) {
                this.runtime.enableTracing();
            }

            // Start the runtime (but don't execute until configuration is done)
            await this.runtime.start(args.program, !!args.stopOnEntry);

            this.sendResponse(response);
            this.logToOutput('launchRequest completed successfully');
        } catch (error) {
            this.logToOutput(`launchRequest failed: ${error}`);
            this.sendErrorResponse(response, 1001, `Failed to launch: ${error}`);
        }
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        const path = args.source.path as string;
        const clientLines = args.lines || [];

        // Clear all breakpoints for this file
        this.runtime.clearBreakpoints(path);

        // Set and verify breakpoint locations
        const actualBreakpoints = clientLines.map(l => {
            const { verified, line, id } = this.runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
            const bp = new Breakpoint(verified, this.convertDebuggerLineToClient(line)) as DebugProtocol.Breakpoint;
            bp.id = id;
            return bp;
        });

        response.body = {
            breakpoints: actualBreakpoints
        };
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        // Frscript is single-threaded
        response.body = {
            threads: [
                new Thread(FrscriptDebugSession.THREAD_ID, "main")
            ]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
        const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
        const endFrame = startFrame + maxLevels;

        const stk = this.runtime.stack(startFrame, endFrame);

        response.body = {
            stackFrames: stk.frames.map(f => {
                const clientLine = this.convertDebuggerLineToClient(f.line);
                // Log for debugging
                this.runtime.log(`Stack frame: ${f.name} at line ${f.line} -> client line ${clientLine}`);
                
                return new StackFrame(
                                    f.index,
                                    f.name,
                                    this.createSource(f.file),
                                    clientLine
                                );
            }),
            totalFrames: stk.count
        };
        this.sendResponse(response);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const scopes: Scope[] = [
            new Scope("Local", this.variableHandles.create("local"), false),
            new Scope("Global", this.variableHandles.create("global"), true)
        ];

        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
        const variables: DebugProtocol.Variable[] = [];
        const id = this.variableHandles.get(args.variablesReference);

        if (id) {
            const vars = this.runtime.getVariables(id);
            for (const [name, value] of Object.entries(vars)) {
                const variable = this.createVariable(name, value);
                variables.push(variable);
            }
        }

        response.body = {
            variables: variables
        };
        this.sendResponse(response);
    }

    private createVariable(name: string, value: any): DebugProtocol.Variable {
        const valueStr = this.formatValue(value);
        const type = this.getType(value);
        
        let variablesReference = 0;
        
        // If it's a complex type, create a handle for it
        if (typeof value === 'object' && value !== null) {
            const handle = `${name}:${JSON.stringify(value)}`;
            variablesReference = this.variableHandles.create(handle);
        }

        return {
            name: name,
            value: valueStr,
            type: type,
            variablesReference: variablesReference
        };
    }

    private formatValue(value: any): string {
        if (value === null || value === undefined) {
            return 'null';
        }
        if (typeof value === 'string') {
            return `"${value}"`;
        }
        if (Array.isArray(value)) {
            return `[${value.map(v => this.formatValue(v)).join(', ')}]`;
        }
        if (typeof value === 'object') {
            // Struct or object
            const entries = Object.entries(value).map(([k, v]) => `${k}: ${this.formatValue(v)}`);
            return `{${entries.join(', ')}}`;
        }
        return String(value);
    }

    private getType(value: any): string {
        if (value === null || value === undefined) {
          return 'null';
        }
        if (Array.isArray(value)) {
          return 'list';
        }
        if (typeof value === 'object') {
          return 'struct';
        }
        return typeof value;
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.logToOutput('continueRequest called');
        try {
            this.runtime.continue();
            this.sendResponse(response);
        } catch (error) {
            this.logToOutput(`continueRequest failed: ${error}`);
            this.sendErrorResponse(response, 1002, `Failed to continue: ${error}`);
        }
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.logToOutput('nextRequest (step) called');
        try {
            this.runtime.step();
            this.sendResponse(response);
        } catch (error) {
            this.logToOutput(`nextRequest failed: ${error}`);
            this.sendErrorResponse(response, 1003, `Failed to step: ${error}`);
        }
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this.logToOutput('stepInRequest called');
        try {
            this.runtime.stepIn();
            this.sendResponse(response);
        } catch (error) {
            this.logToOutput(`stepInRequest failed: ${error}`);
            this.sendErrorResponse(response, 1004, `Failed to step in: ${error}`);
        }
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
        this.logToOutput('stepOutRequest called');
        try {
            this.runtime.stepOut();
            this.sendResponse(response);
        } catch (error) {
            this.logToOutput(`stepOutRequest failed: ${error}`);
            this.sendErrorResponse(response, 1005, `Failed to step out: ${error}`);
        }
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
        this.logToOutput('pauseRequest called');
        try {
            this.runtime.pause();
            this.sendResponse(response);
        } catch (error) {
            this.logToOutput(`pauseRequest failed: ${error}`);
            this.sendErrorResponse(response, 1006, `Failed to pause: ${error}`);
        }
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        this.logToOutput('disconnectRequest called');
        try {
            this.runtime.stop();
            this.sendResponse(response);
            this.logToOutput('disconnectRequest completed');
        } catch (error) {
            this.logToOutput(`disconnectRequest failed: ${error}`);
            this.sendErrorResponse(response, 1007, `Failed to disconnect: ${error}`);
        }
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        let reply: string | undefined;
        let rv: any;

        try {
            rv = this.runtime.evaluate(args.expression, args.context === 'hover');
            reply = this.formatValue(rv);
        } catch (e) {
            reply = `Error: ${e}`;
        }

        response.body = {
            result: reply,
            variablesReference: 0
        };
        this.sendResponse(response);
    }

    protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
        const id = this.variableHandles.get(args.variablesReference);
        
        if (id) {
            try {
                const value = this.runtime.setVariable(id, args.name, args.value);
                response.body = {
                    value: this.formatValue(value),
                    variablesReference: 0
                };
            } catch (e) {
                response.success = false;
                response.message = String(e);
            }
        }

        this.sendResponse(response);
    }

    private createSource(filePath: string): Source {
        return new Source(path.basename(filePath), this.convertDebuggerPathToClient(filePath));
    }
}

// Start the debug session only if run as standalone (for backward compatibility)
if (require.main === module) {
    FrscriptDebugSession.run(FrscriptDebugSession);
}
