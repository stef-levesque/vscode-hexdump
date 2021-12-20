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
    const config = vscode.workspace.getConfiguration('hexdump');
    const firstLine: number = config['showOffset'] ? 1 : 0;
    const hexLineLength: number = config['width'] * 2;
    const firstByteOffset: number = config['showAddress'] ? 10 : 0;
    const lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    const firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);

    // check if within a valid section
    if (pos.line < firstLine || pos.character < firstByteOffset) {
        return;
    }

    let offset = (pos.line - firstLine) * config['width'];
    const s = pos.character - firstByteOffset;
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
    const config = vscode.workspace.getConfiguration('hexdump');
    const firstLine: number = config['showOffset'] ? 1 : 0;
    const hexLineLength: number = config['width'] * 2;
    const firstByteOffset: number = config['showAddress'] ? 10 : 0;
    const lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    const firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);

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
    const config = vscode.workspace.getConfiguration('hexdump');
    const hexLineLength: number = config['width'] * 2;
    const firstByteOffset: number = config['showAddress'] ? 10 : 0;
    const lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    const firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);
    const lastAsciiOffset: number = firstAsciiOffset + config['width'];

    const startPos = getPosition(startOffset, ascii);
    let endPos = getPosition(endOffset, ascii);
    endPos = new vscode.Position(endPos.line, endPos.character + (ascii ? 1 : 2));

    let ranges = [];
    const firstOffset = ascii ? firstAsciiOffset : firstByteOffset;
    const lastOffset = ascii ? lastAsciiOffset : lastByteOffset;
    for (let i = startPos.line; i <= endPos.line; ++i) {
        const start = new vscode.Position(i, i == startPos.line ? startPos.character : firstOffset);
        const end = new vscode.Position(i, i == endPos.line ? endPos.character : lastOffset);
        ranges.push(new vscode.Range(start, end));
    }

    return ranges;
}

export interface Format {
    nibbles     : number,
    radix       : number,
    littleEndian: boolean,
    width       : number,
    uppercase   : boolean,
    showAddress : boolean,
    showAscii   : boolean,
    sizeDisplay : number
};

// this is the version of `Format` that is sent to `hexy`
// you can convert `Format` to `HexyFormat` by calling `getHexyFormat()`
export interface HexyFormat {
    format      : string,  // corresponds to `Format.nibbles: number`
    radix       : number,
    littleEndian: boolean,
    width       : number,
    caps        : string, // corresponds to `Format.uppercase: boolean`
    numbering   : string, // corresponds to `Format.showAddress: boolean`
    annotate    : string, // corresponds to `Format.showAscii: boolean`
    length      : number
};

export interface IEntry {
    data        : Uint8Array;
    isDirty     : boolean;
    isDeleted   : boolean;
    format      : Format;       // if not set, the default format is applied
    watcher?    : vscode.FileSystemWatcher;
    decorations?: vscode.Range[]; 
}

const _files = new Map<string, IEntry>(); // this map contains the contents of the known files indexed by their names


function getDefaultFormat(): Format {
    const config = vscode.workspace.getConfiguration('hexdump');
    const result: Format = {
        nibbles     : config['nibbles'],
        radix       : config['radix'],
        littleEndian: config['littleEndian'],
        width       : config['width'],
        uppercase   : config['uppercase'],
        showAddress : config['showAddress'],
        showAscii   : config['showAscii'],
        sizeDisplay : config['sizeDisplay']
    };
    return result;
}

export function getHexyFormat(format: Format): HexyFormat {
    const result: HexyFormat = {
        format      : format.nibbles == 16 ? 'sixteens'
                    : format.nibbles == 8 ? 'eights'
                    : format.nibbles == 4 ? 'fours'
                    :                       'twos',
        radix       : format.radix,
        littleEndian: format.littleEndian,
        width       : format.width,
        caps        : format.uppercase ? 'upper' : 'lower',
        numbering   : format.showAddress ? 'hex_digits' : 'none',
        annotate    : format.showAscii ? 'ascii' : 'none',
        length      : format.sizeDisplay
    };
    return result;
}

async function resetFile(uri: vscode.Uri, isDirty: boolean, isDeleted: boolean, watcher?: vscode.FileSystemWatcher) {
    let data: Buffer = undefined;
    try {
        if (!isDeleted) {
            data = await fs.promises.readFile(uri.fsPath);
        }
    } catch {
        isDeleted = true;
    }

    const entry: IEntry = {
        data: data,
        isDirty: isDirty,
        isDeleted: isDeleted,
        format: (_files.has(uri.toString()) && _files.get(uri.toString()).format) ? _files.get(uri.toString()).format : getDefaultFormat(),
        watcher: watcher ? watcher : (_files.has(uri.toString())) ? _files.get(uri.toString()).watcher : undefined,
        decorations: (_files.has(uri.toString())) ? _files.get(uri.toString()).decorations : undefined
    };
    _files.set(uri.toString(), entry);
}

async function onChange(uri: vscode.Uri, isDirty: boolean, isDeleted: boolean) {
    await resetFile(uri, isDirty, isDeleted);
    HexdumpContentProvider.instance.update(fakeUri(uri));
}

export async function getEntry(hexdumpUri: vscode.Uri): Promise<IEntry> {
    if (hexdumpUri.scheme === 'hexdump') {
        const physicalUri = realUri(hexdumpUri);

        if (!_files.has(physicalUri.toString())) { // never seen this file before: read it AND create watcher
            let watcher = vscode.workspace.createFileSystemWatcher(physicalUri.fsPath, false, false, false);
            // TODO: the `onDidDelete()` never fires if the whole directory has been deleted.  Need to monitor the whole chain of parent directories
            watcher.onDidChange(async uri => {
                await onChange(uri, false, false); // TODO: this overwrites local changes.  Ask first
            });
            watcher.onDidCreate(async uri => {
                await onChange(uri, false, false);
            });
            watcher.onDidDelete(async uri => {
                await onChange(uri, false, true);
            });

            await resetFile(physicalUri, false, false, watcher); // adds the entry to the `_files`
        }
        return _files.get(physicalUri.toString());
    }
    return null;
}

export function onDocumentClosed(doc: vscode.TextDocument) {
    const uri = realUri(doc.uri).toString();
    if (_files.has(uri) && _files.get(uri).watcher) {
        _files.get(uri).watcher.dispose();
    }
    _files.delete(uri);
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
