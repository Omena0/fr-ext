import * as vscode from 'vscode';
import * as path from 'path';

export class FrscriptTaskProvider implements vscode.TaskProvider {
    static FrscriptType = 'frscript';
    
    private tasks: vscode.Task[] | undefined;

    public async provideTasks(): Promise<vscode.Task[]> {
        return this.getTasks();
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        return undefined;
    }

    private async getTasks(): Promise<vscode.Task[]> {
        if (this.tasks !== undefined) {
            return this.tasks;
        }

        this.tasks = [];

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return this.tasks;
        }

        for (const folder of workspaceFolders) {
            const frFiles = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/*.fr'),
                '**/node_modules/**'
            );

            frFiles.forEach(file => {
                this.tasks!.push(this.createRunTask(file, folder));
                this.tasks!.push(this.createBuildTask(file, folder));
            });
        }

        return this.tasks;
    }

    private createRunTask(file: vscode.Uri, folder: vscode.WorkspaceFolder): vscode.Task {
        const fileName = path.basename(file.fsPath);
        const relativePath = path.relative(folder.uri.fsPath, file.fsPath);

        const definition: vscode.TaskDefinition = {
            type: FrscriptTaskProvider.FrscriptType,
            task: 'run',
            file: relativePath
        };

        const execution = new vscode.ShellExecution(`fr "${file.fsPath}"`);

        const task = new vscode.Task(
            definition,
            folder,
            `Run ${fileName}`,
            FrscriptTaskProvider.FrscriptType,
            execution,
            '$frscript'
        );

        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: true
        };

        return task;
    }

    private createBuildTask(file: vscode.Uri, folder: vscode.WorkspaceFolder): vscode.Task {
        const fileName = path.basename(file.fsPath);
        const relativePath = path.relative(folder.uri.fsPath, file.fsPath);
        const outputFile = file.fsPath.replace('.fr', '.frb');

        const definition: vscode.TaskDefinition = {
            type: FrscriptTaskProvider.FrscriptType,
            task: 'build',
            file: relativePath
        };

        const execution = new vscode.ShellExecution(`fr -c "${file.fsPath}" -o "${outputFile}"`);

        const task = new vscode.Task(
            definition,
            folder,
            `Build ${fileName}`,
            FrscriptTaskProvider.FrscriptType,
            execution,
            '$frscript'
        );

        task.group = vscode.TaskGroup.Build;

        return task;
    }
}

export function registerTaskProvider(context: vscode.ExtensionContext): void {
    const taskProvider = new FrscriptTaskProvider();
    
    context.subscriptions.push(
        vscode.tasks.registerTaskProvider(
            FrscriptTaskProvider.FrscriptType,
            taskProvider
        )
    );
}

export function createRunCurrentFileCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('frscript.runCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'frscript') {
            vscode.window.showErrorMessage('No active Frscript file');
            return;
        }

        // Save file first
        await editor.document.save();

        const filePath = editor.document.uri.fsPath;
        const terminal = vscode.window.createTerminal('Frscript Run');
        terminal.show();
        terminal.sendText(`fr "${filePath}"`);
    });
}

export function createBuildCurrentFileCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('frscript.buildCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'frscript') {
            vscode.window.showErrorMessage('No active Frscript file');
            return;
        }

        // Save file first
        await editor.document.save();

        const filePath = editor.document.uri.fsPath;
        const outputFile = filePath.replace('.fr', '.frb');
        
        const terminal = vscode.window.createTerminal('Frscript Build');
        terminal.show();
        terminal.sendText(`fr -c "${filePath}" -o "${outputFile}"`);
    });
}

export function configureProblemMatcher(): void {
    // The problem matcher configuration is defined in package.json
    // This is just a placeholder for any runtime setup needed
}
