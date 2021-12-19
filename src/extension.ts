'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import { sprintf } from 'sprintf-js';
import * as MemoryMap from 'nrf-intel-hex';

import HexdumpContentProvider from './contentProvider';
import HexdumpHoverProvider from './hoverProvider';
import HexdumpStatusBar from './statusBar';
import { getEntry, getOffset, getPosition, getRanges, triggerUpdateDecorations, getBufferSelection, realUri, fakeUri } from './util';

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('hexdump');
    const charEncoding: BufferEncoding = config['charEncoding'];
    const btnEnabled: string = config['btnEnabled'];

    let statusBar = new HexdumpStatusBar();
    context.subscriptions.push(statusBar);

    const smallDecorationType = vscode.window.createTextEditorDecorationType({
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

    vscode.window.onDidChangeTextEditorSelection(async e => {
        if (e && e.textEditor.document.languageId === 'hexdump') {
            let numLine = e.textEditor.document.lineCount
            if (e.selections[0].start.line + 1 == numLine ||
                e.selections[0].end.line + 1 == numLine) {
                    e.textEditor.setDecorations(smallDecorationType, []);
                    return;
                }
            let startOffset = getOffset(e.selections[0].start);
            let endOffset = getOffset(e.selections[0].end);
            if (typeof startOffset == 'undefined' || typeof endOffset == 'undefined') {
                e.textEditor.setDecorations(smallDecorationType, []);
                return;
            }

            const entry = await getEntry(e.textEditor.document.uri);
            if (!entry.isDeleted && entry.data) {
                if (startOffset >= entry.data.length) {
                    startOffset = entry.data.length - 1;
                }
                if (endOffset >= entry.data.length) {
                    endOffset = entry.data.length - 1;
                }
            }

            let ranges = getRanges(startOffset, endOffset, false);
            if (config['showAscii']) {
                ranges = ranges.concat(getRanges(startOffset, endOffset, true));
            }
            e.textEditor.setDecorations(smallDecorationType, ranges);
        }
    }, null, context.subscriptions);

    let hoverProvider = new HexdumpHoverProvider();
    vscode.languages.registerHoverProvider('hexdump', hoverProvider);
    context.subscriptions.push(hoverProvider);

    async function hexdumpFile(filePath: vscode.Uri) {
        const hexUri = fakeUri(filePath);
        if (hexUri) {
            await vscode.commands.executeCommand('vscode.open', hexUri);
        }
    }

    let provider = new HexdumpContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('hexdump', provider));

    vscode.window.onDidChangeActiveTextEditor(e => {
            if (e && e.document && e.document.uri.scheme === 'hexdump') {
                triggerUpdateDecorations(e);
            }
        }, null, context.subscriptions);

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.hexdumpPath', () => {
            // Display a message box to the user
            const wpath = vscode.workspace.rootPath;

            const ibo = <vscode.InputBoxOptions> {
                prompt: "File path",
                placeHolder: "filepath",
                value: wpath
            };

        vscode.window.showInputBox(ibo).then(filePath => {
            hexdumpFile(vscode.Uri.file(filePath));
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.hexdumpOpen', () => {
        const option: vscode.OpenDialogOptions = { canSelectMany: false };

        vscode.window.showOpenDialog(option).then(async fileUri => {
            if (fileUri && fileUri[0]) {
                await hexdumpFile(fileUri[0]);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.hexdumpFile', async fileUri => {
        if (typeof fileUri === 'undefined' || !(fileUri instanceof vscode.Uri)) {
            if (vscode.window.activeTextEditor === undefined) {
                vscode.commands.executeCommand('hexdump.hexdumpPath');
                return;
            }
            fileUri = vscode.window.activeTextEditor.document.uri;
        }

        if (fileUri.scheme === 'hexdump') {
            // toggle with actual file
            const physicalUri = realUri(fileUri);
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document.uri.toString() === physicalUri.toString()) {
                    vscode.window.showTextDocument(editor.document, editor.viewColumn);
                    return;
                }
            }

            await vscode.commands.executeCommand('vscode.open', physicalUri);
        } else {
            await hexdumpFile(fileUri);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.editValue', async () => {
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

        const entry = await getEntry(d.uri);
        const buf = entry.data;

        if (offset >= buf.length || pos.line + 1 == d.lineCount) {
            return;
        }

        const ibo = <vscode.InputBoxOptions> {
            prompt: "Enter value in hexadecimal",
            placeHolder: "value",
            value: sprintf('%02X', buf[offset])
        };

        vscode.window.showInputBox(ibo).then(value => {
            if (typeof value == 'undefined') {
                return;
            }
            let bytes = [];
            let values = value.match(/(?:0x)?([0-9a-fA-F]){2}/g);
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

            getRanges(offset, offset + bytes.length - 1, false).forEach(range => {
                entry.decorations.push(range);
            });
            if (config['showAscii']) {
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

        let offset = getOffset(e.selection.start);
        if (typeof offset == 'undefined') {
            offset = 0;
        }

        const ibo = <vscode.InputBoxOptions> {
            prompt: "Enter value in hexadecimal",
            placeHolder: "address",
            value: sprintf('%08X', offset)
        };

        vscode.window.showInputBox(ibo).then(value => {
            if (typeof value == 'undefined') {
                return;
            }
            let offset = parseInt(value, 16);
            if (isNaN(offset)) {
                return;
            }

            // Translate one to be in the middle of the byte
            const pos = e.document.validatePosition(getPosition(offset).translate(0, 1));
            e.selection = new vscode.Selection(pos, pos);
            e.revealRange(new vscode.Range(pos, pos));
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.exportToFile', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            const option: vscode.SaveDialogOptions = { defaultUri: d.uri.with({ scheme: 'file' }), filters: {} };

            vscode.window.showSaveDialog(option).then(async fileUri => {
                if (fileUri) {
                    await vscode.workspace.fs.writeFile(fileUri, (await getEntry(d.uri)).data);
                    vscode.window.setStatusBarMessage('Hexdump: exported to ' + fileUri, 3000);
                }
            });
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.save', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            await vscode.workspace.fs.writeFile(realUri(d.uri), (await getEntry(d.uri)).data);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.toggleEndian', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.littleEndian = !entry.format.littleEndian;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.toggleCollapsing', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            // entry.format.collapseContiguous = !entry.format.collapseContiguous;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsBytes', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.nibbles = 2;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsWords', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.nibbles = 4;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsDwords', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.nibbles = 8;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsQwords', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.nibbles = 16;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsBin', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.radix = 2;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsOct', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.radix = 8;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsDec', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.radix = 10;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.showAsHex', async () => {
        let d = vscode.window.activeTextEditor.document;
        if (d.uri.scheme === 'hexdump') {
            let entry = await getEntry(d.uri);
            entry.format.radix = 16;
            HexdumpContentProvider.instance.update(fakeUri(d.uri));
            statusBar.update();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.searchString', async () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        let offset = getOffset(e.selection.start);
        if (typeof offset == 'undefined') {
            offset = 0;
        }

        const ibo = <vscode.InputBoxOptions> {
            prompt: "Enter string to search",
            placeHolder: "string"
        };

        vscode.window.showInputBox(ibo).then(async (value: string) => {
            if (typeof value !== 'string' || value.length == 0) {
                return;
            }

            const entry = await getEntry(d.uri);
            const index = Buffer.from(entry.data).indexOf(value, offset, charEncoding);

            if (index == -1) {
                vscode.window.setStatusBarMessage("string not found", 3000);
            } else {
                // Translate one to be in the middle of the byte
                const pos = e.document.validatePosition(getPosition(index).translate(0, 1));
                e.selection = new vscode.Selection(pos, pos);
                e.revealRange(new vscode.Range(pos, pos));
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.searchHex', async () => {
        const e = vscode.window.activeTextEditor;
        const d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        const offset: number = getOffset(e.selection.start) || 0;

        const ibo = <vscode.InputBoxOptions>{
            prompt: "Enter HEX string to search",
            placeHolder: "HEX string"
        };

        const value: string = await vscode.window.showInputBox(ibo);
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

        const index = Buffer.from((await getEntry(d.uri)).data).indexOf(searchBuf, offset);

        if (index == -1) {
            vscode.window.setStatusBarMessage("HEX string not found", 3000);
            return;
        }

        // Translate one to be in the middle of the byte
        const pos = e.document.validatePosition(getPosition(index).translate(0, 1));
        e.selection = new vscode.Selection(pos, pos);
        e.revealRange(new vscode.Range(pos, pos));
    }));

    const CopyAsFormatHeader = "// Generated by vscode-hexdump (http://github.com/stef-levesque/vscode-hexdump)\n\n";

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsFormat', () => {
        const formats = ["Text", "C", "Golang", "Java", "JSON", "Base64", "HexString", "Literal", "IntelHex"];
        vscode.window.showQuickPick(formats, { ignoreFocusOut: true }).then((format) => {
            if (format && format.length > 0) {
                vscode.commands.executeCommand('hexdump.copyAs' + format);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsText', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = getBufferSelection(e.document, e.selection);
        if (buffer) {
            await vscode.env.clipboard.writeText(buffer.toString());
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsC', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = await getBufferSelection(e.document, e.selection);
        if (buffer) {
            const len = buffer.length;
            let content: string = CopyAsFormatHeader;
            content += "unsigned char rawData[" + len + "] =\n{";

            for (let i = 0; i < len; ++i) {
                if (i % 8 == 0) {
                    content += "\n\t";
                }
                const byte = buffer[i].toString(16);
                content += (byte.length < 2 ? "0x0" : "0x") + byte + ", ";
            }

            content += "\n};\n";

            if (/^win/.test(process.platform)) {
                content = content.replace(/\n/g, '\r\n');
            }

            await vscode.env.clipboard.writeText(content);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsGolang', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = await getBufferSelection(e.document, e.selection);
        if (buffer) {
            const len = buffer.length;
            let content: string = CopyAsFormatHeader;
            content += "// RawData (" + len + " bytes)\n";
            content += "var RawData = []byte{";

            for (let i = 0; i < len; ++i) {
                if (i % 8 == 0) {
                    content += "\n\t";
                }
                const byte = buffer[i].toString(16);
                content += (byte.length < 2 ? "0x0" : "0x") + byte + ", ";
            }

            content += "\n}\n";

            if (/^win/.test(process.platform)) {
                content = content.replace(/\n/g, '\r\n');
            }

            await vscode.env.clipboard.writeText(content);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsJava', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = await getBufferSelection(e.document, e.selection);
        if (buffer) {
            const len = buffer.length;
            let content: string = CopyAsFormatHeader;
            content += "byte rawData[] =\n{";

            for (let i = 0; i < len; ++i) {
                if (i % 8 == 0) {
                    content += "\n\t";
                }
                const byte = buffer[i].toString(16);
                content += (byte.length < 2 ? "0x0" : "0x") + byte + ", ";
            }

            content += "\n};\n";

            if (/^win/.test(process.platform)) {
                content = content.replace(/\n/g, '\r\n');
            }

            vscode.env.clipboard.writeText(content);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsJSON', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = await getBufferSelection(e.document, e.selection);
        if (buffer) {
            await vscode.env.clipboard.writeText(buffer.toJSON().toString());
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsBase64', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = await getBufferSelection(e.document, e.selection);
        if (buffer) {
            await vscode.env.clipboard.writeText(buffer.toString('base64'));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsHexString', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = await getBufferSelection(e.document, e.selection);
        if (buffer) {
            await vscode.env.clipboard.writeText(buffer.toString('hex'));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsLiteral', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = await getBufferSelection(e.document, e.selection);
        if (buffer) {
            await vscode.env.clipboard.writeText('\\x' + buffer.toString('hex').match(/.{1,2}/g).join('\\x'));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hexdump.copyAsIntelHex', async () => {
        let e = vscode.window.activeTextEditor;
        let buffer = await getBufferSelection(e.document, e.selection);
        if (buffer) {
            let address = e.selection.isEmpty ? 0 : getOffset(e.selection.start);
            let memMap = new MemoryMap();
            memMap.set(address, buffer);
            await vscode.env.clipboard.writeText(memMap.asHexString());
        }
    }));
}

// this method is called when your extension is deactivated
export function deactivate() {
}
