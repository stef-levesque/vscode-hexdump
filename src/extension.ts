'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';

var hexdump = require('hexdump-nodejs');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    
    var dict = [];
    function getBuffer(filepath) : Buffer {
        if (dict[filepath]) {
            return dict[filepath];
        }
        
        let buf = fs.readFileSync(filepath);
        dict[filepath] = buf;
        
        return buf;
    }

    class HexdumpContentProvider implements vscode.TextDocumentContentProvider {
        private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
        
        public provideTextDocumentContent(uri: vscode.Uri): string {
            return hexdump(getBuffer(uri.fsPath));
        }
        
        get onDidChange(): vscode.Event<vscode.Uri> {
            return this._onDidChange.event;
        }
        
        public update(uri: vscode.Uri) {
            this._onDidChange.fire(uri);
        }
    }

    let provider = new HexdumpContentProvider();
    let registration = vscode.workspace.registerTextDocumentContentProvider('hexdump', provider);


    let disposable = vscode.commands.registerCommand('hexdump.hexdumpFile', () => {
        // Display a message box to the user
        var wpath = vscode.workspace.rootPath;

        var ibo = <vscode.InputBoxOptions>{
            prompt: "File path",
            placeHolder: "filepath",
            value: wpath
        }

        vscode.window.showInputBox(ibo).then(filePath => {
            if (typeof filePath == 'undefined') {
                return;
            }
            if (!fs.existsSync(filePath)) {
                return;
            }

            let fileUri = vscode.Uri.file(filePath);
            let hexUri = vscode.Uri.parse( fileUri.toString().replace('file:', 'hexdump:') );

            vscode.workspace.openTextDocument(hexUri).then(doc => {
                vscode.window.showTextDocument(doc);
            });
        });
    });
    
    let disposable2 = vscode.commands.registerCommand('hexdump.editValue', () => {
        let e = vscode.window.activeTextEditor;
        let s = e.selection.start;
        let d = e.document;
        
        // check if within hex buffer section
        if (s.line < 1 || s.character < 10 || s.character > 57) {
            return;
        }
        
        var offset = (s.line - 1) * 16;
        offset += Math.floor( (s.character - 10) / 3 );
        
        var buf = getBuffer(d.uri.fsPath);
        
        if (offset >= buf.length) {
            return;
        }
        
        var ibo = <vscode.InputBoxOptions>{
            prompt: "Enter value in hexadecimal",
            placeHolder: "value",
            value: buf[offset].toString(16)
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
            console.log(offset);
        });
    });
    
    

    context.subscriptions.push(disposable2, disposable, registration);
}

// this method is called when your extension is deactivated
export function deactivate() {
}