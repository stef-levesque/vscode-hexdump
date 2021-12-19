import * as vscode from 'vscode';
import * as fs from 'fs';

import HexdumpContentProvider from './contentProvider';

export function fakeUri(uri: vscode.Uri): vscode.Uri { // TODO: would be great not to do that at all
    if (uri.scheme === 'hexdump') {
        return uri;
    }

    return uri.with({
        authority: '',
        path: uri.toString() + '.hexdump',
        scheme: 'hexdump',
        query: '',
        fragment: ''
    });
}

export function realUri(uri: vscode.Uri): vscode.Uri {
    // in case ".hexdump" is appended to the path, it needs to be removed for accessing the underlying file:
    if (uri.path.endsWith('hexdump')) {
        return vscode.Uri.parse(uri.path.slice(0, - '.hexdump'.length));
    }

    return uri;
}

export function getOffset(pos: vscode.Position): number { // TODO: handle 8 byte (16 nibbles) mode, and LE mode
    var config = vscode.workspace.getConfiguration('hexdump');
    var firstLine: number = config['showOffset'] ? 1 : 0;
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);

    // check if within a valid section
    if (pos.line < firstLine || pos.character < firstByteOffset) {
        return;
    }

    var offset = (pos.line - firstLine) * config['width'];
    var s = pos.character - firstByteOffset;
    if (pos.character >= firstByteOffset && pos.character <= lastByteOffset) {
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
        offset += pos.character - firstAsciiOffset;
    }
    return offset;
}

export function getPosition(offset: number, ascii: Boolean = false): vscode.Position {
    var config = vscode.workspace.getConfiguration('hexdump');
    var firstLine: number = config['showOffset'] ? 1 : 0;
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);

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
    for (var i = startPos.line; i <= endPos.line; ++i) {
        var start = new vscode.Position(i, i == startPos.line ? startPos.character : firstOffset);
        var end = new vscode.Position(i, i == endPos.line ? endPos.character : lastOffset);
        ranges.push(new vscode.Range(start, end));
    }

    return ranges;
}

export interface IEntry {
    data: Uint8Array;
    isDirty: boolean;
    isDeleted: boolean;
    decorations?: vscode.Range[];
}

const _files = new Map<string, IEntry>(); // this map contains the contents of the known files indexed by their names

async function resetFile(uri: vscode.Uri) {
    let entry: IEntry = { data: await fs.promises.readFile(uri.fsPath), isDirty: false, isDeleted: false };
    _files.set(uri.toString(), entry);
}

export async function getEntry(hexdumpUri: vscode.Uri): Promise<IEntry> {
    if (hexdumpUri.scheme === 'hexdump') {
        const physicalUri = realUri(hexdumpUri);

        if (!_files.has(physicalUri.toString())) { // never seen this file before: read it AND create watcher
            let watcher = vscode.workspace.createFileSystemWatcher(physicalUri.fsPath, false, false, false);
            // TODO: the `onDidDelete()` never fires if the whole directory has been deleted.  Need to monitor the whole chain of parent directories
            watcher.onDidChange(async uri => {
                await resetFile(uri);
                HexdumpContentProvider.instance.update(fakeUri(uri));
            });
            watcher.onDidCreate(async uri => {
                await resetFile(uri);
                HexdumpContentProvider.instance.update(fakeUri(uri));
            });
            watcher.onDidDelete(async uri => {
                let entry: IEntry = { data: null, isDirty: false, isDeleted: true };
                _files.set(uri.toString(), entry);
                HexdumpContentProvider.instance.update(fakeUri(uri));
            });

            await resetFile(physicalUri); // adds the entry to the `_files`
            console.log("total files tracking: " + _files.size);
        }
        return _files.get(physicalUri.toString());
    }
    return null;
}

export function triggerUpdateDecorations(e: vscode.TextEditor) {
    setTimeout(updateDecorations, 500, e);
}

export async function getBufferSelection(document: vscode.TextDocument, selection?: vscode.Selection): Promise<Buffer | undefined> {
    const entry = await getEntry(document.uri);
    if (entry.isDeleted || !entry.data) {
        return;
    }

    if (selection && !selection.isEmpty) {
        let start = getOffset(selection.start);
        let end = getOffset(selection.end) + 1;
        return Buffer.from(entry.data.slice(start, end));
    }

    return Buffer.from(entry.data);
}

// create a decorator type that we use to mark modified bytes
const modifiedDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,0,0,1)'
});

async function updateDecorations(e: vscode.TextEditor) {
    const uri = e.document.uri;
    const entry = await getEntry(uri);
    if (entry && entry.decorations) {
        e.setDecorations(modifiedDecorationType, entry.decorations);
    }
}
