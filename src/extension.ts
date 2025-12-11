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

interface CImportInfo {
    path: string;
    line: number;
}

interface CLinkInfo {
    libs: string;
    line: number;
}

interface CSymbolInfo {
    name: string;
    type: 'function' | 'struct' | 'macro';
    signature?: string;
    documentation?: string;
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
    { name: 'fread', signature: 'fread(fd: int, size: int = -1) -> bytes', description: 'Read from file descriptor', insertText: 'fread($1)$0' },
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
    { name: 'decode', signature: 'decode(data: bytes) -> str', description: 'Decode bytes to string', insertText: 'decode($1)$0' },
    { name: 'encode', signature: 'encode(text: str) -> bytes', description: 'Encode string to bytes', insertText: 'encode($1)$0' },
    { name: 'upper', signature: 'upper(text: str) -> str', description: 'Convert string to uppercase', insertText: 'upper($1)$0' },
    { name: 'lower', signature: 'lower(text: str) -> str', description: 'Convert string to lowercase', insertText: 'lower($1)$0' },
    { name: 'strip', signature: 'strip(text: str) -> str', description: 'Remove leading and trailing whitespace', insertText: 'strip($1)$0' },
    { name: 'append', signature: 'append(lst: list, item: any)', description: 'Append an item to the list', insertText: 'append($1, $2)$0' },
    { name: 'pop', signature: 'pop(lst: list) -> any', description: 'Remove and return the last item from the list', insertText: 'pop($1)$0' },
    
    // Web/WASM Functions - DOM Query
    { name: 'dom_query', signature: 'dom_query(selector: str) -> int', description: 'Query the DOM for an element by CSS selector', insertText: 'dom_query($1)$0', detail: 'DOM Query: Returns element handle or 0 if not found' },
    { name: 'dom_query_all', signature: 'dom_query_all(selector: str) -> int', description: 'Query the DOM for all matching elements by CSS selector', insertText: 'dom_query_all($1)$0', detail: 'DOM Query: Returns list ID of matching elements' },
    { name: 'dom_create', signature: 'dom_create(tag: str) -> int', description: 'Create a new DOM element with the specified tag', insertText: 'dom_create($1)$0', detail: 'DOM Manipulation: Returns element handle' },
    { name: 'dom_get_body', signature: 'dom_get_body() -> int', description: 'Get the document body element', insertText: 'dom_get_body()$0', detail: 'DOM Query: Returns element handle for <body>' },
    { name: 'dom_get_document', signature: 'dom_get_document() -> int', description: 'Get the document element', insertText: 'dom_get_document()$0', detail: 'DOM Query: Returns element handle for document' },
    
    // Web/WASM Functions - DOM Manipulation
    { name: 'dom_set_text', signature: 'dom_set_text(elemId: int, text: str)', description: 'Set the text content of an element', insertText: 'dom_set_text($1, $2)$0', detail: 'DOM Manipulation: Sets textContent' },
    { name: 'dom_get_text', signature: 'dom_get_text(elemId: int) -> str', description: 'Get the text content of an element', insertText: 'dom_get_text($1)$0', detail: 'DOM Manipulation: Returns textContent as string' },
    { name: 'dom_set_html', signature: 'dom_set_html(elemId: int, html: str)', description: 'Set the HTML content of an element', insertText: 'dom_set_html($1, $2)$0', detail: 'DOM Manipulation: Sets innerHTML' },
    { name: 'dom_get_html', signature: 'dom_get_html(elemId: int) -> str', description: 'Get the HTML content of an element', insertText: 'dom_get_html($1)$0', detail: 'DOM Manipulation: Returns innerHTML as string' },
    { name: 'dom_set_attr', signature: 'dom_set_attr(elemId: int, name: str, value: str)', description: 'Set an attribute on an element', insertText: 'dom_set_attr($1, $2, $3)$0', detail: 'DOM Manipulation: Sets HTML attribute' },
    { name: 'dom_get_attr', signature: 'dom_get_attr(elemId: int, name: str) -> str', description: 'Get an attribute from an element', insertText: 'dom_get_attr($1, $2)$0', detail: 'DOM Manipulation: Gets HTML attribute' },
    { name: 'dom_remove_attr', signature: 'dom_remove_attr(elemId: int, name: str)', description: 'Remove an attribute from an element', insertText: 'dom_remove_attr($1, $2)$0', detail: 'DOM Manipulation: Removes HTML attribute' },
    
    // Web/WASM Functions - DOM Tree
    { name: 'dom_append', signature: 'dom_append(parentId: int, childId: int)', description: 'Append a child element to a parent element', insertText: 'dom_append($1, $2)$0', detail: 'DOM Tree: appendChild()' },
    { name: 'dom_prepend', signature: 'dom_prepend(parentId: int, childId: int)', description: 'Prepend a child element to a parent element', insertText: 'dom_prepend($1, $2)$0', detail: 'DOM Tree: prepend()' },
    { name: 'dom_remove', signature: 'dom_remove(elemId: int)', description: 'Remove an element from the DOM', insertText: 'dom_remove($1)$0', detail: 'DOM Tree: Removes element from its parent' },
    { name: 'dom_clone', signature: 'dom_clone(elemId: int, deep: bool) -> int', description: 'Clone an element (shallow or deep copy)', insertText: 'dom_clone($1, $2)$0', detail: 'DOM Tree: cloneNode()' },
    { name: 'dom_parent', signature: 'dom_parent(elemId: int) -> int', description: 'Get the parent element of an element', insertText: 'dom_parent($1)$0', detail: 'DOM Tree: Returns parent element handle' },
    { name: 'dom_children', signature: 'dom_children(elemId: int) -> int', description: 'Get all child elements of an element', insertText: 'dom_children($1)$0', detail: 'DOM Tree: Returns list of child element handles' },
    
    // Web/WASM Functions - CSS/Style
    { name: 'dom_add_class', signature: 'dom_add_class(elemId: int, class: str)', description: 'Add a CSS class to an element', insertText: 'dom_add_class($1, $2)$0', detail: 'CSS: classList.add()' },
    { name: 'dom_remove_class', signature: 'dom_remove_class(elemId: int, class: str)', description: 'Remove a CSS class from an element', insertText: 'dom_remove_class($1, $2)$0', detail: 'CSS: classList.remove()' },
    { name: 'dom_toggle_class', signature: 'dom_toggle_class(elemId: int, class: str) -> bool', description: 'Toggle a CSS class on an element', insertText: 'dom_toggle_class($1, $2)$0', detail: 'CSS: classList.toggle()' },
    { name: 'dom_has_class', signature: 'dom_has_class(elemId: int, class: str) -> bool', description: 'Check if an element has a CSS class', insertText: 'dom_has_class($1, $2)$0', detail: 'CSS: classList.contains()' },
    { name: 'dom_set_style', signature: 'dom_set_style(elemId: int, prop: str, value: str)', description: 'Set a CSS style property on an element', insertText: 'dom_set_style($1, $2, $3)$0', detail: 'CSS: Sets inline style' },
    { name: 'dom_get_style', signature: 'dom_get_style(elemId: int, prop: str) -> str', description: 'Get a CSS style property from an element', insertText: 'dom_get_style($1, $2)$0', detail: 'CSS: Gets inline style' },
    
    // Web/WASM Functions - Form Elements
    { name: 'dom_get_value', signature: 'dom_get_value(elemId: int) -> str', description: 'Get the value of a form element', insertText: 'dom_get_value($1)$0', detail: 'Form: Returns input value' },
    { name: 'dom_set_value', signature: 'dom_set_value(elemId: int, value: str)', description: 'Set the value of a form element', insertText: 'dom_set_value($1, $2)$0', detail: 'Form: Sets input value' },
    { name: 'dom_focus', signature: 'dom_focus(elemId: int)', description: 'Focus on a form element', insertText: 'dom_focus($1)$0', detail: 'Form: focus()' },
    { name: 'dom_blur', signature: 'dom_blur(elemId: int)', description: 'Blur (unfocus) a form element', insertText: 'dom_blur($1)$0', detail: 'Form: blur()' },
    
    // Web/WASM Functions - Events
    { name: 'dom_on', signature: 'dom_on(elemId: int, event: str, callbackId: int)', description: 'Add an event listener to an element', insertText: 'dom_on($1, $2, $3)$0', detail: 'Events: addEventListener()' },
    { name: 'dom_off', signature: 'dom_off(callbackId: int)', description: 'Remove an event listener', insertText: 'dom_off($1)$0', detail: 'Events: removeEventListener()' },
    { name: 'event_prevent_default', signature: 'event_prevent_default()', description: 'Prevent the default action of an event', insertText: 'event_prevent_default()$0', detail: 'Events: preventDefault()' },
    { name: 'event_stop_propagation', signature: 'event_stop_propagation()', description: 'Stop event propagation', insertText: 'event_stop_propagation()$0', detail: 'Events: stopPropagation()' },
    { name: 'event_target', signature: 'event_target() -> int', description: 'Get the target element of the current event', insertText: 'event_target()$0', detail: 'Events: Returns target element handle' },
    
    // Web/WASM Functions - Timers
    { name: 'set_timeout', signature: 'set_timeout(callbackId: int, ms: int) -> int', description: 'Schedule a callback to run after a delay', insertText: 'set_timeout($1, $2)$0', detail: 'Timers: setTimeout()' },
    { name: 'set_interval', signature: 'set_interval(callbackId: int, ms: int) -> int', description: 'Schedule a callback to run repeatedly', insertText: 'set_interval($1, $2)$0', detail: 'Timers: setInterval()' },
    { name: 'clear_timeout', signature: 'clear_timeout(timerId: int)', description: 'Cancel a scheduled timeout', insertText: 'clear_timeout($1)$0', detail: 'Timers: clearTimeout()' },
    { name: 'clear_interval', signature: 'clear_interval(timerId: int)', description: 'Cancel a scheduled interval', insertText: 'clear_interval($1)$0', detail: 'Timers: clearInterval()' },
    
    // Web/WASM Functions - Console
    { name: 'console_log', signature: 'console_log(text: str)', description: 'Log a message to the browser console', insertText: 'console_log($1)$0', detail: 'Console: console.log()' },
    { name: 'console_error', signature: 'console_error(text: str)', description: 'Log an error to the browser console', insertText: 'console_error($1)$0', detail: 'Console: console.error()' },
    { name: 'console_warn', signature: 'console_warn(text: str)', description: 'Log a warning to the browser console', insertText: 'console_warn($1)$0', detail: 'Console: console.warn()' },
    
    // Web/WASM Functions - Browser APIs
    { name: 'alert', signature: 'alert(text: str)', description: 'Show an alert dialog', insertText: 'alert($1)$0', detail: 'Browser: alert()' },
    { name: 'confirm', signature: 'confirm(text: str) -> bool', description: 'Show a confirmation dialog (returns true if OK)', insertText: 'confirm($1)$0', detail: 'Browser: confirm()' },
    { name: 'prompt', signature: 'prompt(msg: str, default: str) -> str', description: 'Show a prompt dialog and return the user input', insertText: 'prompt($1, $2)$0', detail: 'Browser: prompt()' },
    { name: 'get_location_href', signature: 'get_location_href() -> str', description: 'Get the current page URL', insertText: 'get_location_href()$0', detail: 'Browser: window.location.href (get)' },
    { name: 'set_location_href', signature: 'set_location_href(url: str)', description: 'Navigate to a different URL', insertText: 'set_location_href($1)$0', detail: 'Browser: window.location.href (set)' },
    
    // Web/WASM Functions - Storage
    { name: 'get_local_storage', signature: 'get_local_storage(key: str) -> str', description: 'Get a value from localStorage', insertText: 'get_local_storage($1)$0', detail: 'Storage: localStorage.getItem()' },
    { name: 'set_local_storage', signature: 'set_local_storage(key: str, value: str)', description: 'Set a value in localStorage', insertText: 'set_local_storage($1, $2)$0', detail: 'Storage: localStorage.setItem()' },
    { name: 'remove_local_storage', signature: 'remove_local_storage(key: str)', description: 'Remove a value from localStorage', insertText: 'remove_local_storage($1)$0', detail: 'Storage: localStorage.removeItem()' },
    
    // Web/WASM Functions - Fetch API
    { name: 'fetch_text', signature: 'fetch_text(url: str, callbackId: int)', description: 'Fetch text from a URL asynchronously', insertText: 'fetch_text($1, $2)$0', detail: 'Fetch: Calls callback with response text' },
    { name: 'fetch_json', signature: 'fetch_json(url: str, callbackId: int)', description: 'Fetch JSON from a URL asynchronously', insertText: 'fetch_json($1, $2)$0', detail: 'Fetch: Calls callback with parsed JSON' },
    
    // Web/WASM Functions - JS Interop
    { name: 'js_call', signature: 'js_call(funcName: str, argsJson: str) -> str', description: 'Call a JavaScript function and return the result as JSON', insertText: 'js_call($1, $2)$0', detail: 'JS Interop: Execute arbitrary JS function' },
    { name: 'js_eval', signature: 'js_eval(code: str) -> str', description: 'Evaluate JavaScript code and return the result as JSON', insertText: 'js_eval($1)$0', detail: 'JS Interop: Execute arbitrary JS code' },
    { name: 'js_get_global', signature: 'js_get_global(name: str) -> str', description: 'Get a global JavaScript variable value as JSON', insertText: 'js_get_global($1)$0', detail: 'JS Interop: Access global JS variables' },
];

const keywords = ['if', 'elif', 'else', 'while', 'for', 'in', 'switch', 'case', 'default', 'break', 'continue', 'return', 'assert', 'const', 'struct', 'py_import', 'from', 'as', 'try', 'except', 'raise', 'goto', 'global', 'c_import', 'c_link'];
const types = ['void', 'int', 'float', 'str', 'string', 'bool', 'list', 'dict', 'set', 'bytes', 'any', 'pyobject', 'pyobj', 'function'];

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

// Parse C imports and links from document
function parseCImports(document: vscode.TextDocument): { imports: CImportInfo[], links: CLinkInfo[] } {
    const imports: CImportInfo[] = [];
    const links: CLinkInfo[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const { text } = line;

        // Match c_import statements
        const importMatch = text.match(/^\s*c_import\s+(.+)$/);
        if (importMatch) {
            imports.push({
                path: importMatch[1].trim(),
                line: i
            });
        }

        // Match c_link statements
        const linkMatch = text.match(/^\s*c_link\s+(.+)$/);
        if (linkMatch) {
            links.push({
                libs: linkMatch[1].trim(),
                line: i
            });
        }
    }

    return { imports, links };
}

// Parse C symbols from header files (simplified version)
// In a real implementation, this could use libclang or parse headers more thoroughly
function parseCSymbols(headerPath: string): CSymbolInfo[] {
    // For now, return common raylib functions as an example
    // In production, this would actually parse the header file
    const symbols: CSymbolInfo[] = [];

    if (headerPath.includes('raylib.h')) {
        // Add common raylib functions
        symbols.push(
            { name: 'InitWindow', type: 'function', signature: 'void InitWindow(int width, int height, const char *title)' },
            { name: 'CloseWindow', type: 'function', signature: 'void CloseWindow(void)' },
            { name: 'WindowShouldClose', type: 'function', signature: 'bool WindowShouldClose(void)' },
            { name: 'BeginDrawing', type: 'function', signature: 'void BeginDrawing(void)' },
            { name: 'EndDrawing', type: 'function', signature: 'void EndDrawing(void)' },
            { name: 'ClearBackground', type: 'function', signature: 'void ClearBackground(Color color)' },
            { name: 'DrawText', type: 'function', signature: 'void DrawText(const char *text, int posX, int posY, int fontSize, Color color)' },
            { name: 'DrawRectangle', type: 'function', signature: 'void DrawRectangle(int posX, int posY, int width, int height, Color color)' },
            { name: 'DrawCircle', type: 'function', signature: 'void DrawCircle(int centerX, int centerY, float radius, Color color)' },
            { name: 'IsKeyDown', type: 'function', signature: 'bool IsKeyDown(int key)' },
            { name: 'IsKeyPressed', type: 'function', signature: 'bool IsKeyPressed(int key)' },
            { name: 'GetFrameTime', type: 'function', signature: 'float GetFrameTime(void)' },
            { name: 'SetTargetFPS', type: 'function', signature: 'void SetTargetFPS(int fps)' },
            { name: 'GetScreenWidth', type: 'function', signature: 'int GetScreenWidth(void)' },
            { name: 'GetScreenHeight', type: 'function', signature: 'int GetScreenHeight(void)' },
            { name: 'KEY_W', type: 'macro', signature: '87' },
            { name: 'KEY_S', type: 'macro', signature: '83' },
            { name: 'KEY_UP', type: 'macro', signature: '265' },
            { name: 'KEY_DOWN', type: 'macro', signature: '264' }
        );
    }

    return symbols;
}

// Parse symbols (functions and structs) with their docstrings
function parseSymbols(document: vscode.TextDocument): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const docstrings = parseDocstrings(document);

    // First pass: collect all struct names
    const structNames: string[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const structMatch = line.text.match(/^\s*struct\s+(\w+)\s*\{/);
        if (structMatch) {
            structNames.push(structMatch[1]);
        }
    }

    // Build regex pattern that includes struct types
    const allTypes = [...types, ...structNames];
    const typePattern = allTypes.join('|');

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const { text } = line;

        // Match function declarations (including struct return types)
        const funcRegex = new RegExp(`^\\s*(${typePattern})\\s+(\\w+)\\s*\\(([^)]*)\\)`);
        const funcMatch = text.match(funcRegex);
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
                    // Try to match varargs parameter: type **name or type *name
                    const varargsRegex = new RegExp(`^(${typePattern})\\s+\\*\\*(\\w+)$`);
                    const varargsMatch = trimmedParam.match(varargsRegex);
                    if (varargsMatch) {
                        parameters.push({
                            type: varargsMatch[1] + '**',  // kwargs
                            name: varargsMatch[2]
                        });
                        continue;
                    }
                    const argsRegex = new RegExp(`^(${typePattern})\\s+\\*(\\w+)$`);
                    const argsMatch = trimmedParam.match(argsRegex);
                    if (argsMatch) {
                        parameters.push({
                            type: argsMatch[1] + '*',  // varargs
                            name: argsMatch[2]
                        });
                        continue;
                    }
                    // Try to match typed parameter: type name (including struct types)
                    const typedRegex = new RegExp(`^(${typePattern})\\s+(\\w+)$`);
                    const typedMatch = trimmedParam.match(typedRegex);
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

            // Parse struct fields (including struct-typed fields)
            let currentLine = i + 1;
            while (currentLine < document.lineCount) {
                const fieldLine = document.lineAt(currentLine).text;

                // Check for end of struct
                if (fieldLine.match(/^\s*\}/)) {
                    break;
                }

                // Match field declaration: type name (including struct types)
                const fieldRegex = new RegExp(`^\\s*(${typePattern})\\s+(\\w+)\\s*`);
                const fieldMatch = fieldLine.match(fieldRegex);
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

        // Match variable declarations (including struct types)
        const varRegex = new RegExp(`^\\s*(${typePattern})\\s+(\\w+)\\s*=`);
        const varMatch = text.match(varRegex);
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

        // Skip function definitions - they look like: type name(...)
        // Skip function definitions - they look like: type name(...) { (brace optional)
        const funcDefRegex = new RegExp(`^\\s*(${types.join('|')}|[A-Z][a-zA-Z0-9_]*)\\s+\\w+\\s*\\([^)]*\\)\\s*(\\{|$)`);
        if (funcDefRegex.test(text)) {
            continue;
        }

        // Match function calls and struct construction: Name(args)
        const funcCallRegex = /(\w+)\s*\(([^)]*)\)/g;
        let match;

        while ((match = funcCallRegex.exec(text)) !== null) {
            const funcName = match[1];
            const argsText = match[2].trim();
            const callStart = match.index;
            
            // Extra guard: if the whole line is a function definition, skip
            if (funcDefRegex.test(text)) {
                continue;
            }

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

                        // Allow float to int with warning (auto-casting)
                        if (expectedType === 'int' && inferredType === 'float') {
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Implicit conversion from 'float' to 'int' in struct '${funcName}' field '${structDef.fields[argIdx].name}'`,
                                vscode.DiagnosticSeverity.Warning
                            );
                            diagnostics.push(diagnostic);
                        } else {
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Type mismatch in struct '${funcName}': field '${structDef.fields[argIdx].name}' expects '${expectedType}', but got '${inferredType}'`,
                                vscode.DiagnosticSeverity.Error
                            );
                            diagnostics.push(diagnostic);
                        }
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

            // Check argument count (skip for varargs functions)
            const hasVarargs = funcDef.parameters.some(p => p.type.endsWith('*'));
            if (!hasVarargs && args.length !== funcDef.parameters.length) {
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

                    // Allow float to int with warning (auto-casting)
                    if (expectedType === 'int' && inferredType === 'float') {
                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Implicit conversion from 'float' to 'int' in function '${funcName}' parameter '${funcDef.parameters[argIdx].name}'`,
                            vscode.DiagnosticSeverity.Warning
                        );
                        diagnostics.push(diagnostic);
                    } else {
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
    }

    // Check for variable assignment type mismatches
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const {text} = line;

        // Match variable declarations with initialization: type name = value
        const varDeclMatch = text.match(/^\s*(int|float|str|string|bool|list|dict|set|bytes|any|pyobject|pyobj)\s+(\w+)\s*=\s*(.+)$/);
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

                // Allow float to int with warning (auto-casting)
                if (declaredType === 'int' && inferredType === 'float') {
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Implicit conversion from 'float' to 'int' (value will be truncated)`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.code = 'implicit-cast';
                    diagnostics.push(diagnostic);
                } else {
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

        // Check if function has a decorator (decorated functions are considered used)
        if (func.line > 0) {
            const prevLine = document.lineAt(func.line - 1).text.trim();
            if (prevLine.startsWith('@')) {
                return;  // Has decorator, considered used
            }
        }

        // Search for function calls: funcname(
        const callRegex = new RegExp(`\\b${func.name}\\s*\\(`, 'g');
        const calls = allText.match(callRegex) || [];

        // Search for function references (used as argument or assigned to variable)
        // Matches: funcname) or funcname, or funcname] or = funcname or (funcname, etc.
        const refRegex = new RegExp(`[\\(,=\\[]\\s*${func.name}\\s*[\\),\\]\\s]|[\\(,]\\s*${func.name}\\s*$`, 'gm');
        const refs = allText.match(refRegex) || [];

        // Subtract 1 for the definition itself
        if (calls.length <= 1 && refs.length === 0) {
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
            'fread': 'bytes',
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
            'recv': 'bytes',

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
    if (value.includes('+') || value.includes('-') || value.includes('*') || value.includes('/') || value.includes('**')) {
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

    // Check for bitwise operations (these return int)
    if (value.includes('&') || value.includes('|') || value.includes('^') ||
        value.includes('<<') || value.includes('>>')) {
        return 'int';
    }

    // Check for bitwise operations (should return int, not bool)
    if (value.match(/\d+\s*[&|^]\s*\d+/) ||
        value.match(/\d+\s*<<\s*\d+/) ||
        value.match(/\d+\s*>>\s*\d+/)) {
        return 'int';
    }

    // Check for comparison operations (check for specific operators to avoid matching << or >>)
    if (value.includes('==') || value.includes('!=') ||
        value.includes('<=') || value.includes('>=') ||
        value.match(/[^<>]<[^<]/) || value.match(/[^<>]>[^>]/) ||
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
                const kind = symbol.type === 'function' ? vscode.CompletionItemKind.Function :
                            symbol.type === 'struct' ? vscode.CompletionItemKind.Struct :
                            vscode.CompletionItemKind.Variable;
                const item = new vscode.CompletionItem(symbol.name, kind);
                if (symbol.documentation) {
                    item.documentation = new vscode.MarkdownString(symbol.documentation);
                }
                // Add signature for functions
                if (symbol.type === 'function' && symbol.returnType && symbol.parameters) {
                    const params = symbol.parameters.map(p => `${p.type} ${p.name}`).join(', ');
                    item.detail = `${symbol.returnType} ${symbol.name}(${params})`;
                }
                completionItems.push(item);
            });

            // Add C imported symbols
            const cImports = parseCImports(document);
            if (cImports.imports.length > 0) {
                const cSymbols: CSymbolInfo[] = [];
                for (const imp of cImports.imports) {
                    cSymbols.push(...parseCSymbols(imp.path));
                }

                cSymbols.forEach(cSymbol => {
                    const kind = cSymbol.type === 'function' ? vscode.CompletionItemKind.Function :
                                cSymbol.type === 'struct' ? vscode.CompletionItemKind.Struct :
                                vscode.CompletionItemKind.Constant;
                    const item = new vscode.CompletionItem(cSymbol.name, kind);
                    item.detail = cSymbol.signature || cSymbol.name;
                    if (cSymbol.documentation) {
                        item.documentation = new vscode.MarkdownString(cSymbol.documentation);
                    }
                    item.sortText = '1_' + cSymbol.name; // Sort after built-ins but before user symbols
                    completionItems.push(item);
                });
            }

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
            const lineText = document.lineAt(position.line).text;

            if (isExtensionDevelopment) {
                console.log('Word under cursor:', word);
            }

            if (!word) {
                return undefined;
            }
            
            // Check for method call pattern x.y(...) FIRST
            // Look at the character before the word to see if there's a dot
            const wordStart = wordRange ? wordRange.start.character : position.character;
            if (wordStart > 0 && lineText[wordStart - 1] === '.') {
                // This is a method call - find the object name
                const textBeforeDot = lineText.substring(0, wordStart - 1);
                const objectMatch = textBeforeDot.match(/(\w+)$/);
                
                if (objectMatch) {
                    const objectName = objectMatch[1];
                    const symbols = parseSymbols(document);
                    
                    // First check if it's a user-defined function
                    const funcSymbol = symbols.find(s => s.type === 'function' && s.name === word);
                    
                    if (funcSymbol) {
                        const markdown = new vscode.MarkdownString();
                        
                        // Build signature with object as first parameter: y(x, ...)
                        let signature = `${funcSymbol.returnType || 'void'} ${funcSymbol.name}(${objectName}`;
                        if (funcSymbol.parameters && funcSymbol.parameters.length > 1) {
                            const restParams = funcSymbol.parameters.slice(1).map(p => `${p.type} ${p.name}`).join(', ');
                            signature += ', ' + restParams;
                        }
                        signature += ')';
                        markdown.appendCodeblock(signature, 'frscript');
                        
                        if (funcSymbol.documentation) {
                            markdown.appendMarkdown('\n\n' + funcSymbol.documentation);
                        }
                        
                        markdown.appendMarkdown('\n\n_Method call syntax (equivalent to calling the function with the object as first parameter)_');
                        return new vscode.Hover(markdown);
                    }
                    
                    // Check for built-in type methods
                    const builtinMethods: Record<string, Record<string, { signature: string, description: string }>> = {
                        'bytes': {
                            'decode': {
                                signature: 'str decode(bytes data)',
                                description: 'Decode bytes to string'
                            }
                        },
                        'str': {
                            'encode': {
                                signature: 'bytes encode(str text)',
                                description: 'Encode string to bytes'
                            },
                            'upper': {
                                signature: 'str upper(str text)',
                                description: 'Convert string to uppercase'
                            },
                            'lower': {
                                signature: 'str lower(str text)',
                                description: 'Convert string to lowercase'
                            },
                            'strip': {
                                signature: 'str strip(str text)',
                                description: 'Remove leading and trailing whitespace'
                            }
                        },
                        'list': {
                            'append': {
                                signature: 'void append(list lst, any item)',
                                description: 'Append an item to the list'
                            },
                            'pop': {
                                signature: 'any pop(list lst)',
                                description: 'Remove and return the last item'
                            }
                        }
                    };
                    
                    // Try to infer the object's type
                    const varSymbol = symbols.find(s => s.type === 'variable' && s.name === objectName);
                    let objectType = varSymbol?.varType;
                    
                    // If not found as variable, check if it's a function return type
                    if (!objectType) {
                        // Check if it's a function call result
                        const funcCallMatch = textBeforeDot.match(/(\w+)\s*\([^)]*\)\s*$/);
                        if (funcCallMatch) {
                            const calledFunc = symbols.find(s => s.type === 'function' && s.name === funcCallMatch[1]);
                            objectType = calledFunc?.returnType;
                        }
                    }
                    
                    if (objectType && builtinMethods[objectType] && builtinMethods[objectType][word]) {
                        const method = builtinMethods[objectType][word];
                        const markdown = new vscode.MarkdownString();
                        markdown.appendCodeblock(method.signature, 'frscript');
                        markdown.appendMarkdown('\n\n' + method.description);
                        markdown.appendMarkdown(`\n\n_Method on ${objectType}_`);
                        return new vscode.Hover(markdown);
                    }
                }
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
                    // Build function signature with proper formatting
                    let signature = `${symbol.returnType || 'void'} ${symbol.name}(`;
                    if (symbol.parameters && symbol.parameters.length > 0) {
                        const params = symbol.parameters.map(p => `${p.type} ${p.name}`).join(', ');
                        signature += params;
                    }
                    signature += ')';
                    markdown.appendCodeblock(signature, 'frscript');
                } else if (symbol.type === 'variable') {
                    // Variable - show type and declaration
                    const line = document.lineAt(symbol.line).text;
                    markdown.appendCodeblock(line.trim(), 'frscript');
                } else if (symbol.type === 'struct') {
                    // Struct - show with fields
                    let structCode = `struct ${symbol.name} {\n`;
                    if (symbol.fields && symbol.fields.length > 0) {
                        symbol.fields.forEach(field => {
                            structCode += `    ${field.type} ${field.name}\n`;
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

            // Check C imported symbols
            const cImports = parseCImports(document);
            if (cImports.imports.length > 0) {
                // Collect all C symbols from imported headers
                const cSymbols: CSymbolInfo[] = [];
                for (const imp of cImports.imports) {
                    cSymbols.push(...parseCSymbols(imp.path));
                }

                const cSymbol = cSymbols.find(s => s.name === word);
                if (cSymbol) {
                    const markdown = new vscode.MarkdownString();
                    markdown.appendCodeblock(cSymbol.signature || cSymbol.name, 'c');
                    if (cSymbol.documentation) {
                        markdown.appendMarkdown('\n\n' + cSymbol.documentation);
                    }
                    markdown.appendMarkdown('\n\n🔗 From C import');
                    return new vscode.Hover(markdown);
                }
            }

            // Check for Python attribute access (e.g., ui.Window or window.title)
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
                
                // First check if it's a Frscript method call (x.y(...) where y is a function)
                const funcSymbol = symbols.find(s => s.type === 'function' && s.name === attributeName);
                if (funcSymbol) {
                    const markdown = new vscode.MarkdownString();
                    
                    // Build signature with object as first parameter: y(x, ...)
                    let signature = `${funcSymbol.returnType || 'void'} ${funcSymbol.name}(${objectName}`;
                    if (funcSymbol.parameters && funcSymbol.parameters.length > 1) {
                        const restParams = funcSymbol.parameters.slice(1).map(p => `${p.type} ${p.name}`).join(', ');
                        signature += ', ' + restParams;
                    }
                    signature += ')';
                    markdown.appendCodeblock(signature, 'frscript');
                    
                    if (funcSymbol.documentation) {
                        markdown.appendMarkdown('\n\n' + funcSymbol.documentation);
                    }
                    
                    markdown.appendMarkdown('\n\n_Method call syntax (equivalent to calling the function with the object as first parameter)_');
                    return new vscode.Hover(markdown);
                }

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
        ['function', 'variable', 'parameter', 'struct', 'property', 'method'],
        ['declaration', 'readonly', 'deprecated', 'defaultLibrary']
    );

    const semanticTokensProvider = vscode.languages.registerDocumentSemanticTokensProvider('frscript', {
        provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
            const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
            const symbols = parseSymbols(document);
            const cImports = parseCImports(document);

            // Collect C function names
            const cFunctions: Set<string> = new Set();
            if (cImports.imports.length > 0) {
                for (const imp of cImports.imports) {
                    const cSymbols = parseCSymbols(imp.path);
                    cSymbols.forEach(s => {
                        if (s.type === 'function') {
                            cFunctions.add(s.name);
                        }
                    });
                }
            }

            // Highlight declarations
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

            // Highlight C function calls with defaultLibrary modifier
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                const funcCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
                let match;

                while ((match = funcCallRegex.exec(line)) !== null) {
                    const funcName = match[1];
                    if (cFunctions.has(funcName)) {
                        // Highlight as C function (method token type with defaultLibrary modifier)
                        tokensBuilder.push(
                            new vscode.Range(i, match.index, i, match.index + funcName.length),
                            'method',
                            ['defaultLibrary']
                        );
                    }
                }
            }

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
            const braceStack: { line: number, depth: number }[] = [];
            const regionStack: number[] = [];
            let maxDepth = 8; // Support up to 8 levels of nesting

            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;

                // Count opening and closing braces on this line
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];

                    if (char === '{') {
                        braceStack.push({ line: i, depth: braceStack.length });
                    } else if (char === '}' && braceStack.length > 0) {
                        const start = braceStack.pop()!;
                        // Only create folding ranges for nesting up to maxDepth
                        if (start.depth < maxDepth) {
                            ranges.push(new vscode.FoldingRange(start.line, i));
                        }
                    }
                }

                // Support region comments
                if (line.match(/\/\/\s*region/)) {
                    regionStack.push(i);
                } else if (line.match(/\/\/\s*endregion/) && regionStack.length > 0) {
                    const start = regionStack.pop()!;
                    ranges.push(new vscode.FoldingRange(start, i, vscode.FoldingRangeKind.Region));
                }
            }

            return ranges;
        }
    });

    // 14. Inlay hints provider - DISABLED
    // Removed to avoid cluttering the editor with parameter name hints

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
        foldingProvider
        // inlayHintsProvider removed
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
