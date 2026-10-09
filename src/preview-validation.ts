import { validateTranslation } from './core/translation';
import { escapeXml } from './core/xml';

Object.assign(globalThis, { rodelValidatePreview: (before: string, after: string, translation: boolean) => {
    escapeXml(after);
    if (translation) validateTranslation(before, after);
} });
