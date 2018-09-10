'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import { sprintf } from 'sprintf-js';

import HexdumpContentProvider from './contentProvider'
import HexdumpHoverProvider from './hoverProvider';
import HexdumpStatusBar from './statusBar';
import { getFileSize, getBuffer, getEntry, getOffset, getPhysicalPath, getPosition, getRanges, triggerUpdateDecorations, toArrayBuffer } from './util';

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('hexdump');
    const charEncoding: string = config['charEncoding'];
    const btnEnabled: string = config['btnEnabled'];
    let littleEndian = config['littleEndian'];

    let statusBar = new HexdumpStatusBar();
    context.subscriptions.push(statusBar);

    var smallDecorationType = vscode.window.createTextEditorDecorationType({
        borderWidth: '1px',
        borderStyle: 'solid',
        overviewRulerColor: 'blue',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        light: {
            // this color will be used in light color themes
            borderColor: 'darkblue'
        },
        dark: {
            // this color will be used in dark color themes
            borderColor: 'lightblue'
        }
    });

    function updateButton() {
        vscode.commands.executeCommand('setContext', 'hexdump:btnEnabled', btnEnabled);
    }

    function updateConfiguration() {
        updateButton();
        statusBar.update();

        for (let d of vscode.workspace.textDocuments) {
            if (d.languageId === 'hexdump') {
                provider.update(d.uri);
            }
        }
    }
    vscode.workspace.onDidChangeConfiguration(updateConfiguration);
    updateConfiguration();

    vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e && e.textEditor.document.languageId === 'hexdump') {
            let numLine = e.textEditor.document.lineCount
            if (e.selections[0].start.line + 1 == numLine ||
                e.selections[0].end.line + 1 == numLine) {
                e.textEditor.setDecorations(smallDecorationType, []);
                return;
            }
            let startOffset = getOffset(e.selections[0].start);
            let endOffset = getOffset(e.selections[0].end);
            if (typeof startOffset == 'undefined' ||
                typeof endOffset == 'undefined') {
                e.textEditor.setDecorations(smallDecorationType, []);
                return;
            }

            var ranges = getRanges(startOffset, endOffset, false);
            if (config['showAscii']) {
                ranges = ranges.concat(getRanges(startOffset, endOffset, true));
            }
            e.textEditor.setDecorations(smallDecorationType, ranges);
        }
    }, null, context.subscriptions);

    let hoverProvider = new HexdumpHoverProvider();
    vscode.languages.registerHoverProvider('hexdump', hoverProvider);
    context.subscriptions.push(hoverProvider);

    function hexdumpFile(filePath) {
        if (typeof filePath == 'undefined') {
            return;
        }
        if (!fs.existsSync(filePath)) {
            return;
        }

        let fileUri = vscode.Uri.file(filePath.concat('.hexdump'));
        // add 'hexdump' extension to assign an editorLangId
        let hexUri = fileUri.with({ scheme: 'hexdump' });

        vscode.commands.executeCommand('vscode.open', hexUri);
    }


    let provider = new HexdumpContentProvider();
    let registration = vscode.workspace.registerTextDocumentContentProvider('hexdump', provider);

    vscode.window.onDidChangeActiveTextEditor(e => {
        if (e && e.document && e.document.uri.scheme === 'hexdump') {
            triggerUpdateDecorations(e);
        }
    }, null, context.subscriptions);

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.hexdumpPath', () => {
        // Display a message box to the user
        var wpath = vscode.workspace.rootPath;

        var ibo = <vscode.InputBoxOptions>{
            prompt: "File path",
            placeHolder: "filepath",
            value: wpath
        }

        vscode.window.showInputBox(ibo).then(filePath => {
            hexdumpFile(filePath);
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.hexdumpOpen', () => {
        //const defaultUri = vscode.Uri.file(filepath);
        const option: vscode.OpenDialogOptions = { canSelectMany: false };

        vscode.window.showOpenDialog(option).then(fileUri => {
            if (fileUri && fileUri[0]) {
                hexdumpFile(fileUri[0].fsPath);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.hexdumpFile', (fileUri) => {

        if (typeof fileUri == 'undefined' || !(fileUri instanceof vscode.Uri)) {
            if (vscode.window.activeTextEditor === undefined) {
                vscode.commands.executeCommand('hexdump.hexdumpPath');
                return;
            }
            fileUri = vscode.window.activeTextEditor.document.uri;
        }

        if (fileUri.scheme === 'hexdump') {
            //toggle with actual file
            var filePath = getPhysicalPath(fileUri);
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document.uri.fsPath === filePath) {
                    vscode.window.showTextDocument(editor.document, editor.viewColumn);
                    return;
                }
            }

            vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath));

        } else {
            hexdumpFile(fileUri.fsPath);
        }

    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.editValue', () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        let pos = e.selection.start;
        let offset = getOffset(pos);
        if (typeof offset == 'undefined') {
            return;
        }

        var entry = getEntry(d.uri);
        var buf = entry.buffer;

        if (offset >= buf.length ||
            pos.line + 1 == d.lineCount) {
            return;
        }

        var ibo = <vscode.InputBoxOptions>{
            prompt: "Enter value in hexadecimal",
            placeHolder: "value",
            value: sprintf('%02X', buf[offset])
        }

        vscode.window.showInputBox(ibo).then(value => {
            if (typeof value == 'undefined') {
                return;
            }
            let bytes = [];
            let values = value.split(' ');
            for (let i = 0; i < values.length; i++) {
                let number = parseInt(values[i], 16);
                if (isNaN(number)) {
                    return;
                }
                bytes.push(number);
            }
            bytes.forEach((byte, index) => {
                buf[offset + index] = byte;
            });

            entry.isDirty = true;

            if (!entry.decorations) {
                entry.decorations = [];
            }

            const posBuffer = getPosition(offset);
            entry.decorations.push(new vscode.Range(posBuffer, posBuffer.translate(0, 3 * bytes.length - 1)))
            if (config['showAscii']) {
                const posAscii = getPosition(offset, true);
                entry.decorations.push(new vscode.Range(posAscii, posAscii.translate(0, bytes.length)))
            }

            provider.update(d.uri);
            statusBar.update();
            triggerUpdateDecorations(e);

            e.selection = new vscode.Selection(pos, pos);
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.gotoAddress', () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        var offset = getOffset(e.selection.start);
        if (typeof offset == 'undefined') {
            offset = 0;
        }

        var ibo = <vscode.InputBoxOptions>{
            prompt: "Enter value in hexadecimal",
            placeHolder: "address",
            value: sprintf('%08X', offset)
        }

        vscode.window.showInputBox(ibo).then(value => {
            if (typeof value == 'undefined') {
                return;
            }
            let offset = parseInt(value, 16);
            if (isNaN(offset)) {
                return;
            }

            // Translate one to be in the middle of the byte
            var pos = e.document.validatePosition(getPosition(offset).translate(0, 1));
            e.selection = new vscode.Selection(pos, pos);
            e.revealRange(new vscode.Range(pos, pos));

        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.exportToFile', () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        const filepath = getPhysicalPath(d.uri);
        const defaultUri = vscode.Uri.file(filepath);
        const option: vscode.SaveDialogOptions = { defaultUri: d.uri.with({ scheme: 'file' }), filters: {} };

        vscode.window.showSaveDialog(option).then(fileUri => {
            console.log(fileUri ? fileUri.toString() : 'undefined');
        });
    }));


    context.subscriptions.push(vscode.commands.registerCommand('hexdump.save', () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        let filepath = getPhysicalPath(d.uri);
        var buf = getBuffer(d.uri);
        fs.writeFile(filepath, buf, (err) => {
            if (err) {
                return vscode.window.setStatusBarMessage('Hexdump: ERROR ' + err, 3000);
            }

            vscode.window.setStatusBarMessage('Hexdump: exported to ' + filepath, 3000);
        });

    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.toggleEndian', () => {
        littleEndian = !littleEndian;
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.searchString', () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        var offset = getOffset(e.selection.start);
        if (typeof offset == 'undefined') {
            offset = 0;
        }

        var ibo = <vscode.InputBoxOptions>{
            prompt: "Enter string to search",
            placeHolder: "string"
        }

        vscode.window.showInputBox(ibo).then((value: string) => {
            if (typeof value !== 'string' || value.length == 0) {
                return;
            }

            var buf = getBuffer(d.uri);

            var index = buf.indexOf(value, offset, charEncoding);

            if (index == -1) {
                vscode.window.setStatusBarMessage("string not found", 3000);
                return;
            }

            var pos = e.document.validatePosition(getPosition(index));
            e.selection = new vscode.Selection(pos, pos);
            e.revealRange(new vscode.Range(pos, pos));

        });
    }));

}

// this method is called when your extension is deactivated
export function deactivate() {
}