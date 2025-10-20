

# Frscript support

Adds [Frscript](https://github.com/Omena0/fr) language support to VSCode.

## Installing fr

```zsh
pip install fr
```

## Features

- **Syntax Highlighting** - Full syntax highlighting for Frscript
- **Debugging** - Integrated debugging support
- **Autocomplete** - IntelliSense for built-in functions and user-defined code
- **Snippets** - Code snippets for common patterns:
  - Process management (fork, wait, sleep, exit, getpid)
  - Socket I/O (socket, bind, connect, listen, accept, send, recv)
  - File operations (fopen, fread, fwrite)
  - HTTP/Chat server templates
  - Control flow (if/else, loops, switch)
  - Function declarations
  - And much more!
- **Python Integration** - Seamless Python interop with py_import, py_call, py_getattr
- **Type Checker** - Basic type checking and validation
- **Rename Symbol** - Smart symbol renaming
- **Refactorings** - Code refactoring support
- **Method Call Syntax** - Object-oriented syntax for built-in functions (e.g., `sock.recv()`)


