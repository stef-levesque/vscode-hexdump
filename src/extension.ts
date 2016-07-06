'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';

var hexdump = require('hexdump-nodejs');
var sprinf = require('sprintf-js').sprintf;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    
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
        
        // check if within hex buffer section
        let s = e.selection.start;
        if (s.line < 1 || s.character < 10 || s.character > 57) {
            return;
        }
        
        var offset = (s.line - 1) * 16;
        offset += Math.floor( (s.character - 10) / 3 );
        
        var buf = getBuffer(d.uri);
        
        if (offset >= buf.length) {
            return;
        }

        var ibo = <vscode.InputBoxOptions>{
            prompt: "Enter value in hexadecimal",
            placeHolder: "value",
            value: sprinf('%02X', buf[offset])
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
        });
    });
    
    

    context.subscriptions.push(disposable2, disposable, registration);
}

// this method is called when your extension is deactivated
export function deactivate() {
}