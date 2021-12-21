'use strict';

import * as vscode from 'vscode';
import * as Long from 'long';

const iconvLite = require('iconv-lite');

import { getEntry, getOffset } from './util';

export default class HexdumpHoverProvider implements vscode.HoverProvider {
    public dispose() {
    }

    public async provideHover(document, position, token) : Promise<vscode.Hover> { 
        return new Promise<vscode.Hover>(async resolve => {
            const showInspector = vscode.workspace.getConfiguration('hexdump').get<boolean>('showInspector');
            const charEncoding = vscode.workspace.getConfiguration('hexdump').get<string>('charEncoding');
            if (!showInspector) {
                return resolve(null);
            }

            const entry = await getEntry(document.uri);
            const f = entry.format;
            let offset = getOffset(entry, position);
            if (typeof offset == 'undefined') {
                return resolve(null);
            }

            let content: string = "Hex Inspector";
            content += (f.littleEndian ? " Little" : " Big") + " Endian\n";
            content += "Address: 0x" + offset.toString(16).padStart(8, "0") + "\n";

            let sel = vscode.window.activeTextEditor.selection;
            if (sel.contains(position)) {
                let start = getOffset(entry, sel.start);
                let end = getOffset(entry, sel.end);
                content += "Selection: 0x" + start.toString(16).padStart(8, "0");
                content += " - 0x" + end.toString(16).padStart(8, "0") + "\n";
                content += ""
            }

            let array = entry.data;
            if (array === undefined) {
                return resolve(null);
            }

            const view = new DataView(array.buffer, offset);

            const int8 = view.getInt8(0);
            content += "Int8:   " + int8.toString().padStart(21, " ") + "                " + (int8 < 0 ? "(-0x" : " (0x") + Math.abs(int8).toString(16).padStart(2, "0") + ")\n";
            const uint8 = view.getUint8(0);
            content += "Uint8:  " + uint8.toString().padStart(21, " ") + "                 (0x" + uint8.toString(16).padStart(2, "0") + ")\n";
            const int16 = view.getInt16(0, f.littleEndian);
            content += "Int16:  " + int16.toString().padStart(21, " ") + "              " + (int16 < 0 ? "(-0x" : " (0x") + Math.abs(int16).toString(16).padStart(4, "0") + ")\n";
            const uint16 = view.getUint16(0, f.littleEndian);
            content += "Uint16: " + uint16.toString().padStart(21, " ") + "               (0x" + uint16.toString(16).padStart(4, "0") + ")\n";
            const int32 = view.getInt32(0, f.littleEndian);
            content += "Int32:  " + int32.toString().padStart(21, " ") + "          " + (int32 < 0 ? "(-0x" : " (0x") + Math.abs(int32).toString(16).padStart(8, "0") + ")\n";
            const uint32 = view.getUint32(0, f.littleEndian);
            content += "Uint32: " + uint32.toString().padStart(21, " ") + "           (0x" + uint32.toString(16).padStart(8, "0") + ")\n";
            const int64 = Long.fromBytes(array.slice(offset), false, f.littleEndian)
            content += "Int64:  " + int64.toString().padStart(21, " ") + (int64.isNegative() ? "  (-0x" : "   (0x") + (int64.isNegative() ? int64.negate() : int64).toString(16).padStart(16, "0") + ")\n";
            const uint64 = Long.fromBytes(array.slice(offset), true, f.littleEndian)
            content += "Uint64: " + uint64.toString().padStart(21, " ") + "   (0x" + uint64.toString(16).padStart(16, "0") + ")\n";
            content += 'Float32: ' + view.getFloat32(0, f.littleEndian).toString() + ' \n';
            content += 'Float64: ' + view.getFloat64(0, f.littleEndian).toString() + ' \n';
            content += '\n';

            if (sel.contains(position)) {
                let start = getOffset(entry, sel.start);
                let end = getOffset(entry, sel.end) + 1;
                content += 'String (' + charEncoding + '):\n';
                let conv = iconvLite.decode(array.slice(start, end), charEncoding);
                content += conv.toString();
            }

            return resolve(new vscode.Hover( {language: 'hexdump', value: content} ));
        });
    }
}
