
# Frscript support

Adds comprehensive [Frscript](https://github.com/Omena0/fr) language support to VSCode.

## Features

### 🎨 **Code Editing**
- **Syntax highlighting** - Full syntax support for Frscript
- **Autocomplete** - Intelligent code completion for built-in functions, user-defined symbols, and Python modules
- **Context-aware suggestions** - Smart completions based on type and context
- **Struct field completion** - Auto-complete struct fields when using dot notation
- **Parameter hints** - Inline parameter names while typing function calls

### 🔧 **Code Quality**
- **Error detection** - Real-time error and warning diagnostics
- **Type checking** - Function and variable type validation
- **Linting** - Detect unused variables, functions, and imports
- **Code metrics** - Cyclomatic complexity, function length, and nesting depth analysis
- **Quick fixes** - Automatic fixes for common issues

### 🔨 **Refactoring**
- **Extract function** - Extract selected code into a new function
- **Extract variable** - Extract expressions into variables
- **Inline variable** - Inline variable values
- **Rename symbol** - Rename functions, variables, and structs across files
- **Convert to typed parameters** - Add type annotations to function parameters
- **Organize imports** - Sort and deduplicate Python imports

### 📝 **Documentation**
- **Doc comment generation** - Auto-generate documentation templates with `///`
- **Markdown support** - Rich formatting in hover tooltips
- **Signature help** - Function signatures while typing

### 🚀 **Execution & Debugging**
- **Run current file** - Execute Frscript files directly
- **Build tasks** - Compile to bytecode
- **Debugging support** - Full debugging with breakpoints and variable inspection
- **Output parsing** - Clickable error messages and stack traces

### 🐍 **Python Integration**
- **Import validation** - Validate Python module imports
- **Auto-import suggestions** - Suggest missing Python imports
- **Dependency tracking** - Track and visualize Python dependencies
- **Generate requirements.txt** - Auto-generate from imports

### 🎨 **Visual Features**
- **Color picker** - Inline color decorations and picker for hex/rgb values
- **Code folding** - Smart folding with region support
- **Breadcrumbs** - Enhanced navigation breadcrumbs
- **Status bar metrics** - Real-time code metrics display

### 🔍 **Navigation**
- **Go to definition** - Jump to symbol definitions
- **Find references** - Find all usages
- **Workspace symbol search** - Search symbols across all files
- **Fuzzy matching** - Smart symbol search

### 📊 **Analysis**
- **Code metrics report** - Interactive metrics viewer
- **Dependency visualization** - View Python dependency tree
- **Complexity analysis** - Identify complex code areas

## Commands

Access via Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- `Frscript: Run Current File` - Execute the current file
- `Frscript: Build Current File` - Compile to bytecode
- `Frscript: Generate Documentation for Function` - Generate docs for current function
- `Frscript: Generate Documentation for All Functions` - Generate docs for entire file
- `Frscript: Extract Function` - Extract selected code to function
- `Frscript: Extract Variable` - Extract expression to variable
- `Frscript: Inline Variable` - Inline variable value
- `Frscript: Convert to Typed Parameters` - Add parameter types
- `Frscript: Organize Imports` - Sort and clean imports
- `Frscript: Show Code Metrics` - View metrics report
- `Frscript: Find Symbol in Workspace` - Search symbols globally
- `Frscript: Generate requirements.txt` - Create Python requirements file
- `Frscript: Show Python Dependencies` - View dependency tree
- `Frscript: Insert Color` - Insert color value

## Configuration

Customize the extension via settings:

```json
{
  "frscript.formatting.indentSize": 4,
  "frscript.formatting.insertSpaces": true,
  "frscript.linting.enabled": true,
  "frscript.metrics.enabled": true,
  "frscript.metrics.maxComplexity": 10,
  "frscript.metrics.maxFunctionLength": 50,
  "frscript.python.validateImports": true,
  "frscript.python.suggestImports": true,
  "frscript.documentation.includeExamples": true
}
```

## Keyboard Shortcuts

- `F5` - Start debugging
- `Ctrl+Shift+B` - Build current file
- `Alt+Shift+F` - Format document

## Requirements

- Frscript runtime installed (`fr` command available)
- VS Code 1.60.0 or higher

## Known Issues

- Complex nested expressions may have limited type inference
- Python import validation requires modules to be installed

## License

PolyForm-Noncommercial-1.0.0
