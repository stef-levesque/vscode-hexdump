import * as vscode from 'vscode';
import * as fs from 'fs';
const hexy = require('hexy');

import HexdumpContentProvider from './contentProvider';

export function fakeUri(uri: vscode.Uri): vscode.Uri {
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

// calculates the offset (in bytes) in the file
// that corresponds to the given position in the view
// this is opposite of `getPosition()`
export function getOffset(entry: IEntry, pos: vscode.Position): number {
    const f = entry.format;
    const firstLine: number = f.showOffset ? 1 : 0;
    const hexLineLength: number = f.width * 2;
    const firstByteOffset: number = f.showAddress ? 10 : 0;
    const lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / f.nibbles - 1;
    const nibbleSize: number = hexy.maxnumberlen(f.nibbles / 2, f.radix);

    // the following line is compensating for inconsistency
    // in `hexy`: the gap between hex and ascii is:
    //            * 4 space chars in 1 byte (2 nibbles) mode
    //            * 2 space chars in all other modes
    const firstAsciiOffset: number = lastByteOffset + (f.nibbles == 2 ? 4 : 2);

    // check if within a valid section
    if (pos.line < firstLine || pos.character < firstByteOffset) {
        return;
    }

    let offset = (pos.line - firstLine) * f.width;
    if (pos.character >= firstByteOffset && pos.character <= lastByteOffset) { // calculating from the hex column
        const s = pos.character - firstByteOffset;
        const group = Math.floor(s / (nibbleSize + 1));
        let nibble = 0;
        if (f.radix == 16 && f.nibbles > 2) { // the byte position within the group only makes sense in HEX mode
            nibble = s - group * (nibbleSize + 1);
            if (f.littleEndian) {
                nibble = f.nibbles - nibble - 1;
            }
        }
        offset += Math.floor((group * f.nibbles + nibble) / 2);
    } else if (pos.character >= firstAsciiOffset) { // calculating from the text column
        offset += pos.character - firstAsciiOffset;
    }
    return offset;
}

// calculates the position within the view
// that corresponds to the given offset in the file
// this is opposite of `getOffset()`
export function getPosition(entry: IEntry, offset: number, ascii: Boolean = false): vscode.Position {
    const f = entry.format;
    const firstLine: number = f.showOffset ? 1 : 0;
    const hexLineLength: number = f.width * 2;
    const firstByteOffset: number = f.showAddress ? 10 : 0;
    const lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / f.nibbles - 1;
    const firstAsciiOffset: number = lastByteOffset + (f.nibbles == 2 ? 4 : 2);

    let row = firstLine + Math.floor(offset / f.width);
    let column = offset % f.width;

    if (ascii) {
        column += firstAsciiOffset;
    } else {
        column = firstByteOffset + column * 2 + Math.floor(column / (f.nibbles / 2));
    }

    return new vscode.Position(row, column);
}

export function getRanges(entry: IEntry, startOffset: number, endOffset: number, ascii: boolean): vscode.Range[] {
    const f = entry.format;
    const hexLineLength: number = f.width * 2;
    const firstByteOffset: number = f.showAddress ? 10 : 0;
    const lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / f.nibbles - 1;
    const firstAsciiOffset: number = lastByteOffset + (f.nibbles == 2 ? 4 : 2);
    const lastAsciiOffset: number = firstAsciiOffset + f.width;

    const startPos = getPosition(entry, startOffset, ascii);
    let endPos = getPosition(entry, endOffset, ascii);
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


// describes how a file is displayed.
// most of these fields are passed to `hexy` via `HexyFormat`
export interface Format {
    nibbles     : number,
    radix       : number,
    littleEndian: boolean,
    width       : number,
    uppercase   : boolean,
    showOffset  : boolean, // doesn't correspond to anything in HexyFormat: the offset line is purely our construct
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

// `IEntry` contains information about a particular viewed file
// all the instances of `IEntry` live in `_files` map
export interface IEntry {
    data        : Uint8Array;
    isDirty     : boolean;
    isDeleted   : boolean;
    format      : Format;       // if not set, the default format is applied
    watcher?    : vscode.FileSystemWatcher;
    decorations?: vscode.Range[]; 
}

// this map contains info of the known files, indexed by their names
const _files = new Map<string, IEntry>();


function getDefaultFormat(): Format {
    const config = vscode.workspace.getConfiguration('hexdump');
    const result: Format = {
        nibbles     : config['nibbles'],
        radix       : config['radix'],
        littleEndian: config['littleEndian'],
        width       : config['width'],
        uppercase   : config['uppercase'],
        showOffset  : config['showOffset'],
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

// updates the stored info about the file and the cached data
// usually happens when the file changes externally
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
        let start = getOffset(entry, selection.start);
        let end = getOffset(entry, selection.end) + 1;
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
