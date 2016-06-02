'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';

var hexdump = require('hexdump-nodejs');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    class HexdumpContentProvider implements vscode.TextDocumentContentProvider {
        public provideTextDocumentContent(uri: vscode.Uri): string {
            return hexdump(fs.readFileSync(uri.fsPath));
        }
    }

    let provider = new HexdumpContentProvider();
    let registration = vscode.workspace.registerTextDocumentContentProvider('hexdump', provider);


    let disposable = vscode.commands.registerCommand('hexdump.hexdumpFile', () => {
        // Display a message box to the user
        var wpath = vscode.workspace.rootPath;

        // ask the PROJECT NAME (suggest the )
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

    context.subscriptions.push(disposable, registration);
}

// this method is called when your extension is deactivated
export function deactivate() {
}