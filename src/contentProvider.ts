'use strict';

import * as vscode from 'vscode';
import { sprintf } from 'sprintf-js';

import { getFileSize, getBuffer } from './util';

var hexy = require('hexy');


export default class HexdumpContentProvider implements vscode.TextDocumentContentProvider {

    private static s_instance: HexdumpContentProvider = null;
    private _currentUri = null;
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
        const sizeDisplay = config['sizeDisplay'];

        return new Promise( async (resolve) => {
            let hexyFmt = {
                format      : config['nibbles'] == 16 ? 'sixteens' :
                              config['nibbles'] == 8 ? 'eights' :
                              config['nibbles'] == 4 ? 'fours' :
                                                       'twos',
                radix       : config['radix'],
                littleEndian: config['littleEndian'],
                width       : config['width'],
                caps        : config['uppercase'] ? 'upper' : 'lower',
                numbering   : config['showAddress'] ? "hex_digits" : "none",
                annotate    : config['showAscii'] ? "ascii" : "none",
                length      : sizeDisplay
            };

            let header = config['showOffset'] ? this.getHeader() : "";
            let tail = '(Reached the maximum size to display. You can change "hexdump.sizeDisplay" in your settings.)';

            let proceed = getFileSize(uri) < sizeWarning ? 'Open' : await vscode.window.showWarningMessage('File might be too big, are you sure you want to continue?', 'Open');
            if (proceed == 'Open') {
                let buf = getBuffer(uri);
                let hexString = header;
                hexString += hexy.hexy(buf, hexyFmt).toString();
                if (buf.length > sizeDisplay) {
                    hexString += tail;
                }

                return resolve(hexString);
            } else {
                return resolve('(hexdump cancelled.)');
            }
        });
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }

    private getHeader(): string {
        const config = vscode.workspace.getConfiguration('hexdump');
        let header = config['showAddress'] ? "  Offset:" : "";
        let line_width = config['width'];
        let group_size = config['nibbles'] / 2;
        let radix = config['radix'];
        let littleEndian = config['littleEndian'];
        let group_len = hexy.maxnumberlen(group_size, radix);

        for (var group = 0; group < line_width / group_size; group++) {
            header += " ".repeat(1 + group_len - (group_size * 2));
            for (var ii = 0; ii < group_size; ii++) {
                let column = group * group_size;
                if (littleEndian) {
                    column += group_size - ii - 1;
                } else {
                    column += ii;
                }
                header += sprintf('%02X', column);
            }
        }

        header += "\t\n";
        return header;
    }
}
