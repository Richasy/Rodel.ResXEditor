import ExcelJS from 'exceljs';
import { parseResource, Operation } from './core/xml';
import { DocumentChange, LanguageDocument } from './documents';

export async function exportWorkbook(items: LanguageDocument[], sourceLanguage: string): Promise<Uint8Array> {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Resources');
    sheet.addRow(['Key', 'Comment', ...items.map(i => i.language)]);
    const resources = items.map(i => parseResource(i.document.getText()));
    const sourceIndex = Math.max(0, items.findIndex(i => i.language === sourceLanguage));
    const keys = [...new Set(resources.flatMap(r => r.entries.map(e => e.key)))].sort();
    for (const key of keys) {
        const entries = resources.map(r => r.entries.find(e => e.key === key));
        const comment = entries[sourceIndex]?.comment ?? entries.find(e => e)?.comment ?? '';
        // Explicit strings: text beginning with '=' must never become an Excel formula.
        sheet.addRow([key, comment, ...entries.map(e => e?.value ?? '')]);
    }
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column, index) => { column.width = index === 0 ? 35 : 55; });
    sheet.eachRow(row => { row.alignment = { wrapText: true, vertical: 'top' }; });
    return new Uint8Array(await book.xlsx.writeBuffer());
}

export async function importWorkbook(bytes: Uint8Array, items: LanguageDocument[], sourceLanguage: string): Promise<DocumentChange[]> {
    if (bytes.length > 10 * 1024 * 1024) { throw new Error('Workbook exceeds the 10 MB import limit.'); }
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    const sheet = book.getWorksheet('Resources') ?? book.worksheets[0];
    if (!sheet || sheet.rowCount > 20000 || sheet.columnCount > 100) { throw new Error('Workbook is missing a sheet or exceeds import limits (20,000 rows, 100 columns).'); }
    const text = (cell: ExcelJS.Cell): string => {
        if (cell.value === null || cell.value === undefined) { return ''; }
        if (typeof cell.value !== 'string') { throw new Error(`Cell ${cell.address} must be plain text; formulas and numeric cells are not accepted.`); }
        return cell.value;
    };
    const headers = Array.from({ length: sheet.columnCount }, (_, i) => text(sheet.getRow(1).getCell(i + 1)));
    if (headers[0] !== 'Key' || headers[1] !== 'Comment' || new Set(headers).size !== headers.length || headers.slice(2).some(h => !items.some(i => i.language === h))) { throw new Error('Expected unique headers Key, Comment and existing language codes. Create unknown languages before importing.'); }
    if (headers.length < 3) { throw new Error('At least one language column is required.'); }
    const changes = items.map(item => ({ uri: item.document.uri.toString(), version: item.document.version, operations: [] as Operation[] }));
    const parsed = items.map(i => parseResource(i.document.getText()));
    const seen = new Set<string>();
    const sourceIndex = Math.max(0, items.findIndex(i => i.language === sourceLanguage));
    for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
        const row = sheet.getRow(rowIndex);
        const key = text(row.getCell(1));
        if (!key && headers.every((_, i) => !text(row.getCell(i + 1)))) { continue; }
        if (!key.trim() || seen.has(key)) { throw new Error(`Empty or duplicate key in row ${rowIndex}: ${key}`); }
        seen.add(key);
        const comment = text(row.getCell(2));
        items.forEach((item, index) => {
            const col = headers.indexOf(item.language);
            if (col < 2) { return; }
            const value = text(row.getCell(col + 1));
            const entry = parsed[index].entries.find(e => e.key === key);
            const operations = changes[index].operations;
            if (entry?.readonly) {
                if (entry.value !== value || (index === sourceIndex && entry.comment !== comment)) { throw new Error(`Cannot modify read-only resource ${key} (${item.language}).`); }
                return;
            }
            if (!entry) {
                // A blank exported cell also represents an absent entry: keep absence on round trip.
                if (value || (index === sourceIndex && comment)) { operations.push({ kind: 'add', key, value, comment: index === sourceIndex ? comment : '' }); }
            }
            else {
                if (entry.value !== value) { operations.push({ kind: 'set', key, field: 'value', value }); }
                if (index === sourceIndex && entry.comment !== comment) { operations.push({ kind: 'set', key, field: 'comment', value: comment }); }
            }
        });
    }
    // Missing workbook rows are never interpreted as deletions.
    return changes.filter(c => c.operations.length);
}
