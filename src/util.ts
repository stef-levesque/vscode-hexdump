import * as vscode from 'vscode';
import * as fs from 'fs';

import HexdumpContentProvider from './contentProvider'

export function getPhysicalPath(uri: vscode.Uri): string {
    // in case ".hexdump" is appended to the path, it needs to be removed for accessing the underlying file:
    if (uri.fsPath.endsWith('.hexdump')) {
        let filepath = uri.with({ scheme: 'file' }).fsPath.slice(0, -8);
        return filepath;
    }

    return uri.fsPath;
}

export function getFileSize(uri: vscode.Uri) : Number {
    var filepath = getPhysicalPath(uri);
    var fstat = fs.statSync(filepath);
    return fstat ? fstat['size'] : -1;
}

export function getOffset(pos: vscode.Position) : number {
    var config = vscode.workspace.getConfiguration('hexdump');
    var firstLine: number = config['showOffset'] ? 1 : 0;
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);
    var lastAsciiOffset: number = firstAsciiOffset + config['width'];

    // check if within a valid section
    if (pos.line < firstLine || pos.character < firstByteOffset) {
        return;
    }

    var offset = (pos.line - firstLine) * config['width'];
    var s = pos.character - firstByteOffset;
    if (pos.character >= firstByteOffset && pos.character <= lastByteOffset ) {
        // byte section
        if (config['nibbles'] == 8) {
            offset += Math.floor(s / 9) + Math.floor((s + 2) / 9) + Math.floor((s + 4) / 9) + Math.floor((s + 6) / 9);
        } else if (config['nibbles'] == 4) {
            offset += Math.floor(s / 5) + Math.floor((s + 2) / 5);
        } else {
            offset += Math.floor(s / 3);
        }
    } else if (pos.character >= firstAsciiOffset) {
        // ascii section
        offset += (pos.character - firstAsciiOffset);
    }
    return offset;
}

export function getPosition(offset: number, ascii: Boolean = false) : vscode.Position {
    var config = vscode.workspace.getConfiguration('hexdump');
    var firstLine: number = config['showOffset'] ? 1 : 0;
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);
    var lastAsciiOffset: number = firstAsciiOffset + config['width'];

    let row = firstLine + Math.floor(offset / config['width']);
    let column = offset % config['width'];

    if (ascii) {
        column += firstAsciiOffset;
    } else {
        if (config['nibbles'] == 8) {
            column = firstByteOffset + column * 2 + Math.floor(column / 4);
        } else if (config['nibbles'] == 4) {
            column = firstByteOffset + column * 2 + Math.floor(column / 2);
        } else {
            column = firstByteOffset + column * 3;
        }
    }

    return new vscode.Position(row, column);
}

export function getRanges(startOffset: number, endOffset: number, ascii: boolean): vscode.Range[] {
    var config = vscode.workspace.getConfiguration('hexdump');
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);
    var lastAsciiOffset: number = firstAsciiOffset + config['width'];

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

interface IEntry {
    buffer: Buffer;
    isDirty: boolean;
    waiting: boolean;
    watcher: fs.FSWatcher;
    decorations?: vscode.Range[];
}

interface Map<T> {
    [uri: string]: T;
}

let dict: Map<IEntry> = {};

export function getBuffer(uri: vscode.Uri) : Buffer | undefined {
    return getEntry(uri).buffer;
}

export function getEntry(uri: vscode.Uri): IEntry | undefined {
    // ignore text files with hexdump syntax
    if (uri.scheme !== 'hexdump') {
        return;
    }

    var filepath = getPhysicalPath(uri);

    if (dict[filepath]) {
        return dict[filepath];
    }
    
    let buf = fs.readFileSync(filepath);
    
    // fs watch listener
    const fileListener = (event: string, name: string | Buffer) => {
        console.warn("fileListener from util.ts is fired")
        if (dict[filepath].waiting === false) {
            dict[filepath].waiting = true;
            setTimeout(() => {
                try {
                    const currentWatcher = dict[filepath].watcher;
                    const newWatcher = fs.watch(filepath, fileListener);
                    dict[filepath] = { buffer: fs.readFileSync(filepath), isDirty: false, waiting: false, watcher: newWatcher, decorations:[] };
                    HexdumpContentProvider.instance.update(uri);
                    if (vscode.window.activeTextEditor.document.uri === uri) {
                        updateDecorations(vscode.window.activeTextEditor);
                    }
                    currentWatcher.close();
                } catch (error) {
                    console.warn("exception while watching for external file updates: " + error);
                }
            }, 100);
        }
    }
    const watcher = fs.watch(filepath, fileListener);

    dict[filepath] = { buffer: buf, isDirty: false, waiting: false, watcher };
    
    return dict[filepath];
}


export function toArrayBuffer(buffer: Buffer, offset: number, length: number): ArrayBuffer {
    var ab = new ArrayBuffer(buffer.length);
    var view = new Uint8Array(ab);
    for (var i = 0; i < buffer.length; ++i) {
        view[i] = buffer[offset + i];
    }
    return ab;
}

export function triggerUpdateDecorations(e: vscode.TextEditor) {
    setTimeout(updateDecorations, 500, e);
}

export function getBufferSelection(document: vscode.TextDocument, selection?: vscode.Selection): Buffer | undefined {
    let buf = getBuffer(document.uri);
    if (typeof buf == 'undefined') {
        return;
    }

    if (selection && !selection.isEmpty) {
        let start = getOffset(selection.start);
        let end = getOffset(selection.end) + 1;
        return buf.slice(start, end);
    }
    
    return buf;
}

// create a decorator type that we use to mark modified bytes
const modifiedDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,0,0,1)'
});

function updateDecorations(e: vscode.TextEditor) {
    const uri = e.document.uri;
    const entry = getEntry(uri);
    if (entry) {
        e.setDecorations(modifiedDecorationType, entry.decorations?entry.decorations:[]);
    }
}
