'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import { sprintf } from 'sprintf-js';
import * as clipboardy from 'clipboardy';
import * as MemoryMap from 'nrf-intel-hex';

import HexdumpContentProvider from './contentProvider'
import HexdumpHoverProvider from './hoverProvider';
import HexdumpStatusBar from './statusBar';
import { getFileSize, getBuffer, getEntry, getOffset, getPhysicalPath, getPosition, getRanges, triggerUpdateDecorations, getBufferSelection } from './util';

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('hexdump');
    const charEncoding: string = config['charEncoding'];
    const btnEnabled: string = config['btnEnabled'];

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

            var buf = getBuffer(e.textEditor.document.uri);
            if (buf) {
                if (startOffset >= buf.length) {
                    startOffset = buf.length - 1;
                }
                if (endOffset >= buf.length) {
                    endOffset = buf.length - 1;
                }
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
            let values = value.match(/(?:0x)?([0-9a-fA-F]){2}/g)
            for (let i = 0; i < values.length; i++) {
                let number = parseInt(values[i], 16);
                if (isNaN(number)) {
                    return;
                }
                bytes.push(number);
            }

            if (buf.length < offset + bytes.length) {
                return;
            }

            bytes.forEach((byte, index) => {
                buf[offset + index] = byte;
            });

            entry.isDirty = true;

            if (!entry.decorations) {
                entry.decorations = [];
            }

            const posBuffer = getPosition(offset);
            getRanges(offset, offset + bytes.length - 1, false).forEach(range => {
                entry.decorations.push(range);
            });
            if (config['showAscii']) {
                const posAscii = getPosition(offset, true);
                getRanges(offset, offset + bytes.length - 1, true).forEach(range => {
                    entry.decorations.push(range);
                });
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
            if (fileUri) {
                var buf = getBuffer(d.uri);
                fs.writeFile(fileUri.fsPath, buf, (err) => {
                    if (err) {
                        return vscode.window.setStatusBarMessage('Hexdump: ERROR ' + err, 3000);
                    }

                    vscode.window.setStatusBarMessage('Hexdump: exported to ' + filepath, 3000);
                });
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.save', () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        var entry = getEntry(d.uri);
        let filepath = getPhysicalPath(d.uri);
        var buf = entry.buffer;
        fs.writeFile(filepath, buf, (err) => {
            if (err) {
                return vscode.window.setStatusBarMessage('Hexdump: ERROR ' + err, 3000);
            }

            entry.isDirty = false;
            entry.decorations = [];
            provider.update(d.uri);
            statusBar.update();
            triggerUpdateDecorations(e);
            vscode.window.setStatusBarMessage('Hexdump: exported to ' + filepath, 3000);
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.toggleEndian', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        const littleEndian = config.get('littleEndian');
        config.update('littleEndian', !littleEndian);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.toggleCollapsing', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        const collapseContiguous = config.get('collapseContiguous');
        config.update('collapseContiguous', !collapseContiguous);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsBytes', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        config.update('nibbles', 2);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsWords', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        config.update('nibbles', 4);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsDwords', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        config.update('nibbles', 8);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsQwords', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        config.update('nibbles', 16);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsBin', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        config.update('radix', 2);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsOct', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        config.update('radix', 8);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsDec', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        config.update('radix', 10);
        statusBar.update();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsHex', () => {
        let config = vscode.workspace.getConfiguration('hexdump');
        config.update('radix', 16);
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

            // Translate one to be in the middle of the byte
            const pos = e.document.validatePosition(getPosition(index).translate(0,1));
            e.selection = new vscode.Selection(pos, pos);
            e.revealRange(new vscode.Range(pos, pos));

        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.searchHex', async () => {
        const e = vscode.window.activeTextEditor;
        const d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        const offset : number = getOffset(e.selection.start) || 0;

        const ibo = <vscode.InputBoxOptions>{
            prompt: "Enter HEX string to search",
            placeHolder: "HEX string"
        }

        const value : string = await vscode.window.showInputBox(ibo);
        if (typeof value !== 'string' || value.length == 0 || !/^[a-fA-F0-9\s]+$/.test(value)) {
            return;
        }
        const hexString = value.replace(/\s/g, '');
        if (hexString.length % 2 != 0) {
            return;
        }

        const bytesLength = hexString.length / 2;
        const searchBuf = Buffer.alloc(bytesLength);
        for (let i = 0; i < bytesLength; ++i) {
            const byte = hexString.substr(i * 2, 2);
            searchBuf.writeUInt8(parseInt(byte, 16), i);
        }

        const index = getBuffer(d.uri).indexOf(searchBuf, offset);

        if (index == -1) {
            vscode.window.setStatusBarMessage("HEX string not found", 3000);
            return;
        }

        // Translate one to be in the middle of the byte
        const pos = e.document.validatePosition(getPosition(index).translate(0,1));
        e.selection = new vscode.Selection(pos, pos);
        e.revealRange(new vscode.Range(pos, pos));
    }));

    const CopyAsFormatHeader = "// Generated by vscode-hexdump (http://github.com/stef-levesque/vscode-hexdump)\n\n"

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsFormat', () => {
        const formats = ["Text", "C", "Golang", "Java", "JSON", "Base64", "HexString", "Literal", "IntelHex"];
        vscode.window.showQuickPick(formats, { ignoreFocusOut: true }).then((format) => {
            if (format && format.length > 0) {
                vscode.commands.executeCommand('hexdump.copyAs' + format);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsText', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            clipboardy.write(buffer.toString());
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsC', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            const len = buffer.length;
            let content: string = CopyAsFormatHeader;
            content += "unsigned char rawData[" + len + "] =\n{"

            for (let i = 0; i < len; ++i) {
                if (i % 8 == 0) {
                    content += "\n\t";
                }
                const byte = buffer[i].toString(16);
                content += (byte.length < 2 ? '0x0' : '0x') + byte + ", ";
            }

            content += "\n};\n";

            if (/^win/.test(process.platform)) {
                content = content.replace(/\n/g, '\r\n');
            }

            clipboardy.write(content);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsGolang', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            const len = buffer.length;
            let content: string = CopyAsFormatHeader;
            content += "// RawData (" + len + " bytes)\n"
            content += "var RawData = []byte{"

            for (let i = 0; i < len; ++i) {
                if (i % 8 == 0) {
                    content += "\n\t";
                }
                const byte = buffer[i].toString(16);
                content += (byte.length < 2 ? '0x0' : '0x') + byte + ", ";
            }

            content += "\n}\n";

            if (/^win/.test(process.platform)) {
                content = content.replace(/\n/g, '\r\n');
            }

            clipboardy.write(content);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsJava', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            const len = buffer.length;
            let content: string = CopyAsFormatHeader;
            content += "byte rawData[] =\n{"

            for (let i = 0; i < len; ++i) {
                if (i % 8 == 0) {
                    content += "\n\t";
                }
                const byte = buffer[i].toString(16);
                content += (byte.length < 2 ? '0x0' : '0x') + byte + ", ";
            }

            content += "\n};\n";

            if (/^win/.test(process.platform)) {
                content = content.replace(/\n/g, '\r\n');
            }

            clipboardy.write(content);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsJSON', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            clipboardy.write(JSON.stringify(buffer));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsBase64', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            clipboardy.write(buffer.toString('base64'));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsHexString', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            clipboardy.write(buffer.toString('hex'));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsLiteral', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            clipboardy.write('\\x' + buffer.toString('hex').match(/.{1,2}/g).join('\\x'));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsIntelHex', () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            let address = e.selection.isEmpty ? 0 : getOffset(e.selection.start);
            let memMap = new MemoryMap();
            memMap.set(address, buffer);
            clipboardy.write(memMap.asHexString());
        }
    }));
}

// this method is called when your extension is deactivated
export function deactivate() {
}
