'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';

var hexdump = require('hexdump-nodejs');
var sprintf = require('sprintf-js').sprintf;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    
    let littleEndian = vscode.workspace.getConfiguration('hexdump').get('littleEndian', true);

    var statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    statusBarItem.text = 'HEX';
    statusBarItem.tooltip = littleEndian ? 'Little Endian' : 'Big Endian';

    vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e.document.languageId === 'hexdump') {
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    });

    var dict = [];
    function getBuffer(uri: vscode.Uri) : Buffer {
        // remove the 'hexdump' extension
        let filepath = uri.fsPath.slice(0, -8);
        if (dict[filepath]) {
            return dict[filepath];
        }
        
        let buf = fs.readFileSync(filepath);
        dict[filepath] = buf;
        
        return buf;
    }

    function toArrayBuffer(buffer: Buffer, offset: number, length: number): ArrayBuffer {
        var ab = new ArrayBuffer(buffer.length);
        var view = new Uint8Array(ab);
        for (var i = 0; i < buffer.length; ++i) {
            view[i] = buffer[offset + i];
        }
        return ab;
    }

    vscode.languages.registerHoverProvider('hexdump', {
        provideHover(document, position, token) {
            let offset = getOffset(position);
            if (typeof offset == 'undefined') {
                return;
            }

            var content: string = 'Hex Inspector\n';
            content += 'Address: 0x' + sprintf('%08X', offset) + '\n';

            let sel = vscode.window.activeTextEditor.selection;
            if (sel.contains(position)) {
                let start = getOffset(sel.start);
                let end = getOffset(sel.end);
                content += 'Selection: 0x' + sprintf('%08X', start) + ' - 0x' + sprintf('%08X', end) + '\n';
            }

            let buf = getBuffer(document.uri);
            let arrbuf = toArrayBuffer(buf, offset, 8);
            var view = new DataView(arrbuf);

            content += 'Int8:   ' + sprintf('%12d', view.getInt8(0)) + '\t';
            content += 'Uint8:  ' + sprintf('%12d', view.getUint8(0)) + '\n';
            content += 'Int16:  ' + sprintf('%12d', view.getInt16(0, littleEndian)) + '\t';
            content += 'Uint16: ' + sprintf('%12d', view.getUint16(0, littleEndian)) + '\n';
            content += 'Int32:  ' + sprintf('%12d', view.getInt32(0, littleEndian)) + '\t';
            content += 'Uint32: ' + sprintf('%12d', view.getUint32(0, littleEndian)) + '\n';
            content += 'Float32: ' + sprintf('%f', view.getFloat32(0, littleEndian)) + '\n';
            content += 'Float64: ' + sprintf('%f', view.getFloat64(0, littleEndian)) + '\n';
            return new vscode.Hover(content);
        }
    });

    class HexdumpContentProvider implements vscode.TextDocumentContentProvider {
        private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

        public provideTextDocumentContent(uri: vscode.Uri): string {
            return hexdump(getBuffer(uri));
        }
        
        get onDidChange(): vscode.Event<vscode.Uri> {
            return this._onDidChange.event;
        }
        
        public update(uri: vscode.Uri) {
            this._onDidChange.fire(uri);
        }
    }

    function hexdumpFile(filePath) {
        if (typeof filePath == 'undefined') {
            return;
        }
        if (!fs.existsSync(filePath)) {
            return;
        }

        let fileUri = vscode.Uri.file(filePath);
        // add 'hexdump' extension to assign an editorLangId
        let hexUri = vscode.Uri.parse( fileUri.toString().replace('file:', 'hexdump:').concat('.hexdump') );

        vscode.workspace.openTextDocument(hexUri).then(doc => {
            vscode.window.showTextDocument(doc);
        });

    }

    function getOffset(pos: vscode.Position) : number {
        // check if within hex buffer section
        if (pos.line < 1 || pos.character < 10 || pos.character > 57) {
            return;
        }
        
        var offset = (pos.line - 1) * 16;
        offset += Math.floor( (pos.character - 10) / 3 );

        return offset;
    }

    function getPosition(offset: number) : vscode.Position {
        let row = Math.floor(offset / 16);
        let column = offset % 16;

        return new vscode.Position(1 + row, 10 + column * 3);
    }

    let provider = new HexdumpContentProvider();
    let registration = vscode.workspace.registerTextDocumentContentProvider('hexdump', provider);


    let disposable = vscode.commands.registerCommand('hexdump.hexdumpFile', (fileUri) => {
        if (fileUri) {
            hexdumpFile(fileUri.fsPath);
        } else {
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
        }
    });
    
    let disposable2 = vscode.commands.registerCommand('hexdump.editValue', () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }
        
        let pos = e.selection.start;
        let offset = getOffset(pos);        
        var buf = getBuffer(d.uri);
        
        if (offset >= buf.length) {
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
            let number = parseInt(value, 16);
            if (isNaN(number)) {
                return;
            }
        
            buf[offset] = number;
        
            provider.update(d.uri);

            e.selection = new vscode.Selection(pos, pos);
        });
    });
    
    let disposable3 = vscode.commands.registerCommand('hexdump.gotoAddress', () => {
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

            var pos = e.document.validatePosition( getPosition(offset) );
            e.selection = new vscode.Selection(pos, pos);
            e.revealRange(new vscode.Range(pos, pos));

        });
    });

    let disposable4 = vscode.commands.registerCommand('hexdump.exportToFile', () => {
        let e = vscode.window.activeTextEditor;
        let d = e.document;
        // check if hexdump document
        if (d.uri.scheme !== 'hexdump') {
            return;
        }

        let filepath = d.uri.fsPath.slice(0, -8);

        var ibo = <vscode.InputBoxOptions>{
            prompt: "Export to binary file",
            placeHolder: "file path",
            value: filepath
        }

        vscode.window.showInputBox(ibo).then(filePath => {
            var buf = getBuffer(d.uri);
            fs.writeFile(filePath, buf, (err) => {
                if(err) {
                    return vscode.window.setStatusBarMessage('Hexdump: ERROR ' + err, 3000);
                }

                vscode.window.setStatusBarMessage('Hexdump: exported to ' + filePath, 3000);
            });
        });

    });

    context.subscriptions.push(disposable4, disposable3, disposable2, disposable, registration);
}

// this method is called when your extension is deactivated
export function deactivate() {
}