'use strict';

import * as vscode from 'vscode';
import { sprintf } from 'sprintf-js';
import * as Long from 'long';

var iconvLite = require('iconv-lite');

import { getFileSize, getBuffer, getEntry, getOffset, getPhysicalPath, triggerUpdateDecorations, toArrayBuffer } from './util';

export default class HexdumpHoverProvider {

    public dispose() {

    }

    public async provideHover(document, position, token) : Promise<vscode.Hover> { 
        return new Promise<vscode.Hover>((resolve) => {
            const charEncoding = vscode.workspace.getConfiguration('hexdump').get<string>('charEncoding');
            const littleEndian = vscode.workspace.getConfiguration('hexdump').get<boolean>('littleEndian');
            const showInspector = vscode.workspace.getConfiguration('hexdump').get<boolean>('showInspector');

            if (!showInspector) {
                return resolve();
            }
            let offset = getOffset(position);
            if (typeof offset == 'undefined') {
                return resolve();
            }

            var content: string = 'Hex Inspector';
            content += littleEndian ? ' Little Endian\n' : ' Big Endian\n';
            content += 'Address: 0x' + sprintf('%08X', offset) + '\n';

            let sel = vscode.window.activeTextEditor.selection;
            if (sel.contains(position)) {
                let start = getOffset(sel.start);
                let end = getOffset(sel.end);
                let size = Math.abs(sel.end - sel.start)+1;
                content += 'Selection: '+sprintf('%d', size)+', 0x' + sprintf('%08X', start); 
                content += ' - 0x' + sprintf('%08X', end) + ' \n';
            }

            let buf = getBuffer(document.uri);
            if (typeof buf == 'undefined') {
                return resolve();
            }

            let arrbuf = toArrayBuffer(buf, offset, 8);
            var view = new DataView(arrbuf);

            content += 'Int8:   ' + sprintf('%12d', view.getInt8(0)) + '\t';
            content += 'Uint8:  ' + sprintf('%12d', view.getUint8(0)) + ' \n';
            content += 'Int16:  ' + sprintf('%12d', view.getInt16(0, littleEndian)) + '\t';
            content += 'Uint16: ' + sprintf('%12d', view.getUint16(0, littleEndian)) + ' \n';
            content += 'Int32:  ' + sprintf('%12d', view.getInt32(0, littleEndian)) + '\t';
            content += 'Uint32: ' + sprintf('%12d', view.getUint32(0, littleEndian)) + ' \n';
            content += 'Int64:  ' + Long.fromBytes(new Uint8Array(arrbuf), true, littleEndian).toString() + ' \n';
            content += 'Uint64: ' + Long.fromBytes(new Uint8Array(arrbuf), false, littleEndian).toString() + ' \n';
            content += 'Float32: ' + sprintf('%f', view.getFloat32(0, littleEndian)) + ' \n';
            content += 'Float64: ' + sprintf('%f', view.getFloat64(0, littleEndian)) + ' \n';
            content += '\n';

            if (sel.contains(position)) {
                let start = getOffset(sel.start);
                let end = getOffset(sel.end) + 1;
                content += 'String (' + charEncoding + '):\n';
                let conv = iconvLite.decode(buf.slice(start, end), charEncoding);
                content += conv.toString();
            }

            return resolve(new vscode.Hover( {language: 'hexdump', value: content} )) ;
        });
    }
}