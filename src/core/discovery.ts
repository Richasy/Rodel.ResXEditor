import * as path from 'node:path';

export interface Identity { kind: 'resw' | 'resx'; directory: string; name: string; language: string; group: string }
export function canonicalLanguage(input: string): string {
    if (!input || /[/\\.]/.test(input)) { throw new Error('Enter a BCP-47 language code, such as zh-CN or en-US.'); }
    try { return Intl.getCanonicalLocales(input)[0]; } catch { throw new Error(`Invalid BCP-47 language code: ${input}`); }
}
export function identify(file: string): Identity {
    const ext = path.extname(file).toLowerCase();
    const dir = path.dirname(file);
    const stem = path.basename(file, path.extname(file));
    if (ext === '.resw') {
        let language = '';
        if (path.basename(path.dirname(dir)).toLowerCase() === 'strings') {
            try { language = canonicalLanguage(path.basename(dir)); } catch { /* Plain standalone .resw. */ }
        }
        const directory = language ? path.dirname(dir) : dir;
        return { kind: 'resw', directory, name: stem, language: language || 'neutral', group: `${directory}/${stem}.resw` };
    }
    if (ext !== '.resx') { throw new Error('Choose a .resw or .resx resource file.'); }
    const dot = stem.lastIndexOf('.');
    let language = 'neutral';
    let name = stem;
    if (dot > 0) {
        try { language = canonicalLanguage(stem.slice(dot + 1)); name = stem.slice(0, dot); } catch { /* Dots in a base name. */ }
    }
    return { kind: 'resx', directory: dir, name, language, group: `${dir}/${name}.resx` };
}
export function sameGroup(a: string, b: string): boolean { return identify(a).group === identify(b).group; }
export function resourcePath(directory: string, name: string, kind: 'resw' | 'resx', language: string): string {
    if (!name || /[/\\<>:"|?*]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) { throw new Error('Enter a valid resource file name without an extension or path.'); }
    const culture = canonicalLanguage(language);
    return kind === 'resw' ? path.join(directory, culture, `${name}.resw`) : path.join(directory, `${name}.${culture}.resx`);
}
