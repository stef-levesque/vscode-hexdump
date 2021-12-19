'use strict';

import * as vscode from 'vscode';
import { sprintf } from 'sprintf-js';

import { getEntry, Format, getHexyFormat } from './util';

const hexy = require('hexy');


export default class HexdumpContentProvider implements vscode.TextDocumentContentProvider {
    private static s_instance: HexdumpContentProvider = null;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    constructor() {
        if (HexdumpContentProvider.s_instance) {
            HexdumpContentProvider.s_instance.dispose();
        }
        HexdumpContentProvider.s_instance = this;
    }

    static get instance() {
        return HexdumpContentProvider.s_instance;
    }

    public dispose() {
        this._onDidChange.dispose();
        if (HexdumpContentProvider.s_instance) {
            HexdumpContentProvider.s_instance.dispose();
            HexdumpContentProvider.s_instance = null;
        }
    }

    public provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
        const config = vscode.workspace.getConfiguration('hexdump');
        const sizeWarning = config['sizeWarning'];

        return new Promise( async (resolve) => {
            const entry = await getEntry(uri);
            const format = entry.format;
            const header = format.showAddress ? this.getHeader(format) : '';
            const tail = "(Reached the maximum size to display. You can change `hexdump.sizeDisplay` in your settings.)";

            if (entry.isDeleted || !entry.data) {
                return resolve("the file has been deleted");
            } else {
                const proceed =
                    entry.data.byteLength < sizeWarning
                        ? 'Open'
                        : await vscode.window.showWarningMessage(
                            "File might be too big, are you sure you want to continue?",
                            { modal: true },
                            'Open',
                            'Cancel'
                        );
                if (proceed == 'Open') {
                    let hexString = header;
                    hexString += hexy.hexy(entry.data, getHexyFormat(format)).toString();
                    if (entry.data.length > format.sizeDisplay) {
                        hexString += tail;
                    }
                    return resolve(hexString);
                } else {
                    return resolve("(hexdump cancelled.)"); // TODO: remove this by only coverting the visible part + delta
                }
            }
        });
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }

    private getHeader(format: Format): string {
        let header = format.showAddress ? "  Offset:" : "";
        let line_width = format.width;
        let group_size = format.nibbles / 2;
        let radix = format.radix;
        let littleEndian = format.littleEndian;
        let group_len = hexy.maxnumberlen(group_size, radix);

        for (let group = 0; group < line_width / group_size; group++) {
            header += " ".repeat(1 + group_len - (group_size * 2));
            for (let ii = 0; ii < group_size; ii++) {
                let column = group * group_size;
                if (littleEndian) {
                    column += group_size - ii - 1;
                } else {
                    column += ii;
                }
                header += sprintf("%02X", column);
            }
        }

        header += "\t\n";
        return header;
    }
}
