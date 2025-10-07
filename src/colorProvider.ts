import * as vscode from 'vscode';

export class ColorProvider implements vscode.DocumentColorProvider {
    public provideDocumentColors(document: vscode.TextDocument): vscode.ColorInformation[] {
        const colors: vscode.ColorInformation[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const { text } = line;

            // Match hex colors: #RGB, #RRGGBB, #RRGGBBAA
            const hexRegex = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
            let match;

            while ((match = hexRegex.exec(text)) !== null) {
                const hexValue = match[1];
                const color = this.parseHexColor(hexValue);
                
                if (color) {
                    const start = new vscode.Position(i, match.index);
                    const end = new vscode.Position(i, match.index + match[0].length);
                    const range = new vscode.Range(start, end);
                    
                    colors.push(new vscode.ColorInformation(range, color));
                }
            }

            // Match rgb/rgba: rgb(r, g, b) or rgba(r, g, b, a)
            const rgbRegex = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/g;
            
            while ((match = rgbRegex.exec(text)) !== null) {
                const r = parseInt(match[1]) / 255;
                const g = parseInt(match[2]) / 255;
                const b = parseInt(match[3]) / 255;
                const a = match[4] ? parseFloat(match[4]) : 1;

                const color = new vscode.Color(r, g, b, a);
                const start = new vscode.Position(i, match.index);
                const end = new vscode.Position(i, match.index + match[0].length);
                const range = new vscode.Range(start, end);
                
                colors.push(new vscode.ColorInformation(range, color));
            }
        }

        return colors;
    }

    public provideColorPresentations(
        color: vscode.Color,
        context: { document: vscode.TextDocument; range: vscode.Range }
    ): vscode.ColorPresentation[] {
        const presentations: vscode.ColorPresentation[] = [];

        // Hex format
        const hex = this.colorToHex(color);
        presentations.push(new vscode.ColorPresentation(hex));

        // RGB format
        const r = Math.round(color.red * 255);
        const g = Math.round(color.green * 255);
        const b = Math.round(color.blue * 255);
        
        if (color.alpha < 1) {
            // RGBA
            presentations.push(new vscode.ColorPresentation(`rgba(${r}, ${g}, ${b}, ${color.alpha.toFixed(2)})`));
        } else {
            // RGB
            presentations.push(new vscode.ColorPresentation(`rgb(${r}, ${g}, ${b})`));
        }

        return presentations;
    }

    private parseHexColor(hex: string): vscode.Color | null {
        let r = 0, g = 0, b = 0, a = 1;

        if (hex.length === 3) {
            // #RGB -> #RRGGBB
            r = parseInt(hex[0] + hex[0], 16) / 255;
            g = parseInt(hex[1] + hex[1], 16) / 255;
            b = parseInt(hex[2] + hex[2], 16) / 255;
        } else if (hex.length === 6) {
            // #RRGGBB
            r = parseInt(hex.substring(0, 2), 16) / 255;
            g = parseInt(hex.substring(2, 4), 16) / 255;
            b = parseInt(hex.substring(4, 6), 16) / 255;
        } else if (hex.length === 8) {
            // #RRGGBBAA
            r = parseInt(hex.substring(0, 2), 16) / 255;
            g = parseInt(hex.substring(2, 4), 16) / 255;
            b = parseInt(hex.substring(4, 6), 16) / 255;
            a = parseInt(hex.substring(6, 8), 16) / 255;
        } else {
            return null;
        }

        return new vscode.Color(r, g, b, a);
    }

    private colorToHex(color: vscode.Color): string {
        const r = Math.round(color.red * 255).toString(16).padStart(2, '0');
        const g = Math.round(color.green * 255).toString(16).padStart(2, '0');
        const b = Math.round(color.blue * 255).toString(16).padStart(2, '0');

        if (color.alpha < 1) {
            const a = Math.round(color.alpha * 255).toString(16).padStart(2, '0');
            return `#${r}${g}${b}${a}`;
        }

        return `#${r}${g}${b}`;
    }
}

export function registerColorProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerColorProvider('frscript', new ColorProvider())
    );
}

export function createInsertColorCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('frscript.insertColor', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const colorInput = await vscode.window.showInputBox({
            prompt: 'Enter a color (hex, rgb, or rgba)',
            placeHolder: '#FF5733 or rgb(255, 87, 51)'
        });

        if (!colorInput) {
            return;
        }

        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, colorInput);
        });
    });
}
