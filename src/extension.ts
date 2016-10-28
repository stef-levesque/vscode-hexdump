'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';

var hexdump = require('hexy');
var sprintf = require('sprintf-js').sprintf;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    var config = vscode.workspace.getConfiguration('hexdump');
    var littleEndian = config['littleEndian'];
    var firstLine: number = config['showOffset'] ? 1 : 0;
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 4 ? 2 : 4);
    var lastAsciiOffset: number = firstAsciiOffset + config['width'];
    var charPerLine: number = lastAsciiOffset + 1;
    var sizeWarning: number = config ['sizeWarning'];
    var maxLineCount: number = config['maxLineCount'];

    var statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
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

    function updateStatusBar() {
        statusBarItem.text = littleEndian ? 'hex' : 'HEX';
        statusBarItem.tooltip = littleEndian ? 'Little Endian' : 'Big Endian';
    }

    function updateConfiguration() {
        config = vscode.workspace.getConfiguration('hexdump');
        littleEndian = config['littleEndian'];
        firstLine = config['showOffset'] ? 1 : 0;
        hexLineLength = config['width'] * 2;
        firstByteOffset = config['showAddress'] ? 10 : 0;
        lastByteOffset = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
        firstAsciiOffset = lastByteOffset + (config['nibbles'] == 4 ? 2 : 4);
        lastAsciiOffset = firstAsciiOffset + config['width'];
        charPerLine = lastAsciiOffset + 1;
        sizeWarning = config ['sizeWarning'];
        maxLineCount = config['maxLineCount'];

        updateStatusBar();

        for (let d of vscode.workspace.textDocuments) {
            if (d.languageId === 'hexdump') {
                provider.update(d.uri);
            }
        }
    }
    vscode.workspace.onDidChangeConfiguration(updateConfiguration);
    updateConfiguration();

    vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e.document.languageId === 'hexdump') {
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    });

    vscode.window.onDidChangeTextEditorSelection((e) => {
        if(e.textEditor.document.languageId === 'hexdump') {
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
                ranges = ranges.concat( getRanges(startOffset, endOffset, true) );
            }
            e.textEditor.setDecorations(smallDecorationType, ranges);
        }
    });

    function getRanges(startOffset: number, endOffset: number, ascii: boolean): vscode.Range[] {
        var startPos = getPosition(startOffset, ascii);
        var endPos = getPosition(endOffset, ascii);
        endPos = new vscode.Position(endPos.line, endPos.character + (ascii ? 1 : 2));

        var ranges = [];
        var firstOffset = ascii ? firstAsciiOffset : firstByteOffset;
        var lastOffset = ascii ? lastAsciiOffset : lastByteOffset;
        for (var i=startPos.line; i<=endPos.line; ++i) {
            var start = new vscode.Position(i, (i == startPos.line ? startPos.character : firstOffset));
            var end = new vscode.Position(i, (i == endPos.line ? endPos.character : lastOffset));
            ranges.push(new vscode.Range(start, end));
        }

        return ranges;
    }

    function getPhysicalPath(uri: vscode.Uri) : string {
        if (uri.scheme != 'hexdump') {
            return uri.fsPath;
        }
        // remove the 'hexdump' extension
        let filepath = uri.fsPath.slice(0, -8);
        return filepath;
    }

    function getFileSize(uri: vscode.Uri) : Number {
        var filepath = getPhysicalPath(uri);
        var fstat = fs.statSync(filepath);
        return fstat ? fstat['size'] : -1;
    }

    var dict = [];
    function getBuffer(uri: vscode.Uri) : Buffer {
        // ignore text files with hexdump syntax
        if (uri.scheme != 'hexdump') {
            return;
        }

        var filepath = getPhysicalPath(uri);

        if (dict[filepath]) {
            return dict[filepath];
        }
        
        let buf = fs.readFileSync(filepath);
        
        fs.watch(filepath, function(event, name)
        {
            dict[filepath] = fs.readFileSync(filepath);
            provider.update(uri);
        });

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

            var content: string = 'Hex Inspector';
            content += littleEndian ? ' Little Endian\n' : ' Big Endian\n';
            content += 'Address: 0x' + sprintf('%08X', offset) + '\n';

            let sel = vscode.window.activeTextEditor.selection;
            if (sel.contains(position)) {
                let start = getOffset(sel.start);
                let end = getOffset(sel.end);
                content += 'Selection: 0x' + sprintf('%08X', start) 
                content += ' - 0x' + sprintf('%08X', end) + ' \n';
            }

            let buf = getBuffer(document.uri);
            if (typeof buf == 'undefined') {
                return;
            }

            let arrbuf = toArrayBuffer(buf, offset, 8);
            var view = new DataView(arrbuf);

            content += 'Int8:   ' + sprintf('%12d', view.getInt8(0)) + '\t';
            content += 'Uint8:  ' + sprintf('%12d', view.getUint8(0)) + ' \n';
            content += 'Int16:  ' + sprintf('%12d', view.getInt16(0, littleEndian)) + '\t';
            content += 'Uint16: ' + sprintf('%12d', view.getUint16(0, littleEndian)) + ' \n';
            content += 'Int32:  ' + sprintf('%12d', view.getInt32(0, littleEndian)) + '\t';
            content += 'Uint32: ' + sprintf('%12d', view.getUint32(0, littleEndian)) + ' \n';
            content += 'Float32: ' + sprintf('%f', view.getFloat32(0, littleEndian)) + ' \n';
            content += 'Float64: ' + sprintf('%f', view.getFloat64(0, littleEndian)) + ' \n';
 
            return new vscode.Hover( {language: 'hexdump', value: content} );
        }
    });

    class HexdumpContentProvider implements vscode.TextDocumentContentProvider {
        private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    
        public provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
            let hexyFmt = {
                format      : config['nibbles'] == 4 ? 'fours' : 'twos',
                width       : config['width'],
                caps        : config['uppercase'] ? 'upper' : 'lower',
                numbering   : config['showAddress'] ? "hex_digits" : "none",
                annotate    : config['showAscii'] ? "ascii" : "none"
            };

            let header = config['showOffset'] ? this.getHeader() : "";
            let tail = '(Sorry about that, but we can’t show more of that file right now.)';
            
            if (getFileSize(uri) < sizeWarning) {
                var buf = getBuffer(uri);
                var hexString = hexdump.hexy(buf, hexyFmt).toString();
                var maxIndex = hexString.indexOf('\n', maxLineCount * charPerLine - 1);
                return new Promise( (resolve) => { resolve(header + (maxIndex == -1 ? hexString : hexString.substr(0, maxIndex + 1) + tail)); });
            } else {
                return vscode.window.showWarningMessage('File might be too big, are you sure you want to continue?', 'Open').then(
                    (value) => {
                        if (value == 'Open') {
                            var buf = getBuffer(uri);
                            var hexString = hexdump.hexy(buf, hexyFmt).toString();
                            var maxIndex = hexString.indexOf('\n', maxLineCount * charPerLine - 1);
                            return (header + (maxIndex == -1 ? hexString : hexString.substr(0, maxIndex + 1) + tail));
                        } else {
                            vscode.window.setStatusBarMessage("hexdump cancelled", 3000);
                            return;
                        }
                    },
                    (reason) => {
                        vscode.window.setStatusBarMessage("hexdump cancelled", 3000);
                        return;
                    }
                );
            }
        }
        
        get onDidChange(): vscode.Event<vscode.Uri> {
            return this._onDidChange.event;
        }
        
        public update(uri: vscode.Uri) {
            this._onDidChange.fire(uri);
            this.provideTextDocumentContent(uri);
        }

        private getHeader(): string {
            let header = config['showAddress'] ? "  Offset: " : "";

            for (var i = 0; i < config['width']; ++i) {
                header += sprintf('%02X', i);
                if ((i+1) % (config['nibbles'] / 2) == 0) {
                    header += ' ';
                }
            }

            header += "\t\n";
            return header;
        }
    }

    function hexdumpFile(filePath) {
        if (typeof filePath == 'undefined') {
            return;
        }
        if (!fs.existsSync(filePath)) {
            return;
        }

        let fileUri = vscode.Uri.file(filePath.concat('.hexdump'));
        // add 'hexdump' extension to assign an editorLangId
        let hexUri = fileUri.with( {scheme: 'hexdump'});

        vscode.workspace.openTextDocument(hexUri).then(doc => {
            vscode.window.showTextDocument(doc);
        });

    }

    function getOffset(pos: vscode.Position) : number {
        // check if within a valid section
        if (pos.line < firstLine || pos.character < firstByteOffset) {
            return;
        }

        var offset = (pos.line - firstLine) * config['width'];
        var s = pos.character - firstByteOffset;
        if (pos.character >= firstByteOffset && pos.character <= lastByteOffset ) {
            // byte section
            if (config['nibbles'] == 4) {
                offset += Math.floor(s / 5) + Math.floor((s+2) / 5);
            } else {
                offset += Math.floor(s / 3);
            }
        } else if (pos.character >= firstAsciiOffset) {
            // ascii section
            offset += (pos.character - firstAsciiOffset);
        }
        return offset;
    }

    function getPosition(offset: number, ascii: Boolean = false) : vscode.Position {
        let row = firstLine + Math.floor(offset / config['width']);
        let column = offset % config['width'];

        if (ascii) {
            column += firstAsciiOffset;
        } else {
            if (config['nibbles'] == 4) {
                column = firstByteOffset + column * 2 + Math.floor(column / 2);
            } else {
                column = firstByteOffset + column * 3;
            }
        }

        return new vscode.Position(row, column);
    }

    let provider = new HexdumpContentProvider();
    let registration = vscode.workspace.registerTextDocumentContentProvider('hexdump', provider);


    let disposable = vscode.commands.registerCommand('hexdump.hexdumpFile', (fileUri) => {
        if (typeof fileUri != 'undefined' && fileUri instanceof vscode.Uri) {
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
        
        if (offset >= buf.length ||
            pos.line+1 == d.lineCount ) {
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

        let filepath = getPhysicalPath(d.uri);

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

    let disposable5 = vscode.commands.registerCommand('hexdump.toggleEndian', () => {
        littleEndian = !littleEndian;
        updateStatusBar();
    });

    context.subscriptions.push(disposable5, disposable4, disposable3, disposable2, disposable, registration);
}

// this method is called when your extension is deactivated
export function deactivate() {
}