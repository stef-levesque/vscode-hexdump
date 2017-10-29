'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import { sprintf } from 'sprintf-js';

import { getFileSize, getBuffer } from './util';

var hexdump = require('hexy');

export default class HexdumpContentProvider implements vscode.TextDocumentContentProvider {
    
    private static s_instance: HexdumpContentProvider = null;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    constructor() {
        if(HexdumpContentProvider.s_instance) {
            HexdumpContentProvider.s_instance.dispose();
        }
        HexdumpContentProvider.s_instance = this;
    }

    static get instance() {
        return HexdumpContentProvider.s_instance;
    }

    public dispose() {
        this._onDidChange.dispose();
        if(HexdumpContentProvider.s_instance) {
            HexdumpContentProvider.s_instance.dispose();
            HexdumpContentProvider.s_instance = null;
        }
    }

    public provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
        const config = vscode.workspace.getConfiguration('hexdump');
        const hexLineLength = config['width'] * 2;
        const firstByteOffset = config['showAddress'] ? 10 : 0;
        const lastByteOffset = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
        const firstAsciiOffset = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);
        const lastAsciiOffset = firstAsciiOffset + config['width'];
        const charPerLine = lastAsciiOffset + 1;
        const sizeWarning = config['sizeWarning'];
        const sizeDisplay = config['sizeDisplay'];

        return new Promise( async (resolve) => {
            let hexyFmt = {
                format      : config['nibbles'] == 8 ? 'eights' : 
                            config['nibbles'] == 4 ? 'fours' : 
                            'twos',
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
                hexString += hexdump.hexy(buf, hexyFmt).toString();
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