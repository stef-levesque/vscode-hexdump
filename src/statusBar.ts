'use strict';

import * as vscode from 'vscode';

import { getEntry } from './util';

export default class HexdumpStatusBar {
    private static s_instance: HexdumpStatusBar = null;
    private _statusBarItem: vscode.StatusBarItem;
    private _disposables: vscode.Disposable[] = [];
    private _currentDocument: vscode.TextEditor;

    constructor() {
        if (HexdumpStatusBar.s_instance) {
            HexdumpStatusBar.s_instance.dispose();
        }

        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

        vscode.window.onDidChangeActiveTextEditor(e => {
            if (e && e.document.languageId === 'hexdump') {
                this._statusBarItem.show();
                this._currentDocument = e;
                this.update();
            } else {
                this._statusBarItem.hide();
                this._currentDocument = undefined;
            }
        }, null, this._disposables);

        HexdumpStatusBar.s_instance = this;
    }

    static get instance() {
        return HexdumpStatusBar.s_instance;
    }

    public dispose() {
        this._statusBarItem.dispose;
        if (HexdumpStatusBar.s_instance) {
            HexdumpStatusBar.s_instance.dispose();
            HexdumpStatusBar.s_instance = null;
        }
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    get Item() {
        return this._statusBarItem;
    }

    public async update() {
        if (this._currentDocument) {
            const entry = getEntry(this._currentDocument.document.uri);
            let littleEndian = (await entry).format.littleEndian;
            let uppercase = (await entry).format.uppercase;

            this._statusBarItem.text = (uppercase ? "HEX" : "hex") + " " + (littleEndian ? "LE" : "BE");
            this._statusBarItem.tooltip = (uppercase ? "Upper" : "Lower") + " Case, "
                                        + (littleEndian ? "Little" : "Big") + " Endian";

            let e = vscode.window.activeTextEditor;
            if (e && e.document.uri.scheme === 'hexdump') {
                if ((await getEntry(e.document.uri)).isDirty) {
                    this._statusBarItem.text += " (modified)";
                }
            }
        }
    }
}
