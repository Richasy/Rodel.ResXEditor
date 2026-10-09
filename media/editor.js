/* Copyright (c) Richasy. All rights reserved. */
(() => {
    'use strict';
    const vscode = acquireVsCodeApi();
    const saved = vscode.getState() || {};
    let items = [];
    let source = '';
    let showComments = true;
    let filter = saved.filter || 'all';
    let search = saved.search || '';
    let descending = saved.descending || false;
    let selected = new Set();
    let previewOpen = false;
    let nextId = 0;
    let busy = false;
    let rendering = false;
    let menuOpen = false;
    let nextTooltipId = 0;
    let visibleLanguages = Array.isArray(saved.visibleLanguages) ? new Set(saved.visibleLanguages) : undefined;
    let closePopup;
    const queue = [];
    const app = document.getElementById('app');
    const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
    const icon = name => { const el = element('span', `codicon codicon-${name}`); el.setAttribute('aria-hidden', 'true'); return el; };
    function send(action, data = {}) {
        queue.push({ action, ...data, requestId: ++nextId });
        pump();
    }
    function pump() {
        if (busy || !queue.length) return;
        busy = true;
        const msg = queue.shift();
        if (['add', 'addMany', 'deleteMany', 'copy', 'delete', 'rename'].includes(msg.action)) msg.versions = Object.fromEntries(items.map(i => [i.uri, i.version]));
        if (msg.action === 'set') msg.version = items.find(i => i.uri === msg.uri)?.version;
        vscode.postMessage(msg);
    }
    function button(label, glyph, action, data) {
        const btn = element('button', '', label);
        btn.prepend(icon(glyph)); btn.title = label; btn.setAttribute('aria-label', label);
        btn.addEventListener('click', () => typeof action === 'function' ? action() : send(action, typeof data === 'function' ? data() : data));
        return btn;
    }
    function persist() { vscode.setState({ filter, search, descending, visibleLanguages: visibleLanguages ? [...visibleLanguages] : undefined }); }
    function combo(label, onChange) {
        const host = element('div', 'combo');
        const trigger = element('button', 'combo-trigger'); trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-label', label); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
        const text = element('span', 'combo-text'); trigger.append(text, icon('chevron-down'));
        const popup = element('div', 'combo-popup hidden');
        const list = element('div', 'combo-options'); list.id = `combo-${++nextTooltipId}`; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', label); trigger.setAttribute('aria-controls', list.id);
        const description = element('div', 'combo-description'); popup.append(list, description); host.append(trigger, popup);
        let options = []; let value = ''; let open = false;
        const close = () => { open = false; popup.classList.add('hidden'); trigger.setAttribute('aria-expanded', 'false'); };
        const select = next => { value = next; text.textContent = options.find(option => option.value === value)?.label ?? value; };
        function show() {
            closePopup?.(); closePopup = close; open = true; popup.classList.remove('hidden'); trigger.setAttribute('aria-expanded', 'true');
            list.replaceChildren();
            for (const option of options) {
                const row = element('button', 'combo-option', option.label); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.value === value)); row.dataset.value = option.value;
                if (option.default) row.append(element('span', 'option-note', 'Default'));
                row.addEventListener('focus', () => { description.textContent = option.description || ''; description.classList.toggle('hidden', !option.description); });
                row.addEventListener('click', () => { select(option.value); close(); trigger.focus(); onChange(option.value); }); list.append(row);
            }
            (list.querySelector('[aria-selected="true"]') ?? list.firstElementChild)?.focus();
        }
        trigger.addEventListener('click', () => { if (open) close(); else show(); });
        trigger.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); show(); if (event.key === 'Home') list.firstElementChild?.focus(); if (event.key === 'End') list.lastElementChild?.focus(); } if (event.key === 'Escape') close(); });
        list.addEventListener('keydown', event => {
            const rows = [...list.children]; const current = rows.indexOf(document.activeElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus(); }
            if (event.key === 'Escape' || event.key === 'Tab') { close(); trigger.focus(); if (event.key === 'Escape') event.preventDefault(); }
            if (event.key.length === 1 && /\S/.test(event.key)) { const row = rows.slice(current + 1).concat(rows.slice(0, current + 1)).find(row => row.textContent.toLowerCase().startsWith(event.key.toLowerCase())); if (row) { event.preventDefault(); row.focus(); } }
        });
        document.addEventListener('pointerdown', event => { if (!host.contains(event.target)) close(); });
        return { element: host, trigger, setOptions(next, selected) { if (open) trigger.focus(); options = next; select(selected); close(); }, get value() { return value; }, set value(next) { select(next); } };
    }
    const toolbar = element('header', 'editor-header');
    const identity = element('div', 'identity');
    const fileIcon = element('div', 'file-icon'); fileIcon.append(icon('symbol-string'));
    const fileInfo = element('div', 'file-info');
    const fileTitle = element('h1', 'file-title', 'Resources');
    const fileSubtitle = element('div', 'file-subtitle', 'Language resources'); fileInfo.append(fileTitle, fileSubtitle); identity.append(fileIcon, fileInfo);
    const headerActions = element('div', 'header-actions'); headerActions.setAttribute('role', 'toolbar'); headerActions.setAttribute('aria-label', 'Resources');
    const addButton = button('Add resource', 'add', 'add', { key: '' }); addButton.classList.add('primary');
    const copilotButton = button('Translate', 'sparkle', 'translate', () => ({ keys: [...selected] })); copilotButton.title = 'Translate missing or selected resources with Copilot';
    const saveButton = button('Save all', 'save', 'save'); saveButton.classList.add('icon-button');
    const menuButton = button('More actions', 'ellipsis', () => toggleMenu()); menuButton.classList.add('icon-button'); menuButton.setAttribute('aria-haspopup', 'menu'); menuButton.setAttribute('aria-expanded', 'false');
    headerActions.append(addButton, copilotButton, saveButton, menuButton); toolbar.append(identity, headerActions);
    const menu = element('div', 'action-menu hidden'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Resource actions');
    const menuAction = (label, glyph, action, data) => { const control = button(label, glyph, () => { closeMenu(); if (typeof action === 'function') action(); else send(action, typeof data === 'function' ? data() : data); }); control.setAttribute('role', 'menuitem'); menu.append(control); return control; };
    menuAction('Bulk add', 'list-flat', () => bulkAdd());
    menuAction('Undo', 'discard', 'undo'); menuAction('Redo', 'redo', 'redo');
    menu.append(element('div', 'menu-separator'));
    menuAction('Export', 'export', 'export'); menuAction('Import', 'cloud-download', 'import');
    menu.append(element('div', 'menu-separator'));
    const commentToggle = menuAction('Comments', 'comment', () => send('comments', { value: String(!showComments) }));
    menuAction('Open XML', 'code', 'text');
    function closeMenu() { menuOpen = false; menu.classList.add('hidden'); menuButton.setAttribute('aria-expanded', 'false'); }
    function toggleMenu() { closePopup?.(); menuOpen = !menuOpen; menu.classList.toggle('hidden', !menuOpen); menuButton.setAttribute('aria-expanded', String(menuOpen)); if (menuOpen) menu.querySelector('button').focus(); }
    menu.addEventListener('keydown', event => { const controls = [...menu.querySelectorAll('button')]; const index = controls.indexOf(document.activeElement); if (event.key === 'Escape') { closeMenu(); menuButton.focus(); } if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length].focus(); } if (event.key === 'Tab') closeMenu(); });
    document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !menuButton.contains(event.target)) closeMenu(); });
    const filterbar = element('div', 'filterbar');
    const searchWrap = element('div', 'search-wrap'); searchWrap.append(icon('search'));
    const searchBox = element('input', 'search'); searchBox.type = 'search'; searchBox.placeholder = 'Search key, value or comment'; searchBox.setAttribute('aria-label', searchBox.placeholder); searchBox.value = search;
    searchBox.addEventListener('input', () => { search = searchBox.value; persist(); renderGrid(); }); searchWrap.append(searchBox); filterbar.append(searchWrap);
    const filterBox = combo('Filter resources', value => { filter = value; persist(); renderGrid(); });
    filterBox.setOptions([
        { value: 'all', label: 'All resources', default: true, description: 'Show all resource entries.' },
        { value: 'missing', label: 'Missing translations', description: 'Show entries missing a translation in any target language.' },
        { value: 'same', label: 'Same as source', description: 'Show target values identical to the source language.' },
        { value: 'readonly', label: 'Read-only resources', description: 'Show non-text or unsupported resource types.' }
    ], filter); filterbar.append(filterBox.element);
    const sortButton = button('Sort', 'sort-precedence', () => { descending = !descending; persist(); renderGrid(); }); sortButton.classList.add('icon-button'); filterbar.append(sortButton);
    const filterSpacer = element('div', 'spacer'); filterbar.append(filterSpacer);
    const sourceBox = combo('Source language', value => send('source', { source: value })); sourceBox.element.classList.add('source-picker'); filterbar.append(element('span', 'control-label', 'Source'), sourceBox.element);
    const languageHost = element('div', 'language-picker');
    const languageButton = button('Visible languages', 'filter', () => toggleLanguages()); languageButton.setAttribute('aria-expanded', 'false'); languageButton.setAttribute('aria-haspopup', 'dialog');
    const languagePopup = element('section', 'language-popup hidden'); languagePopup.setAttribute('role', 'dialog'); languagePopup.setAttribute('aria-label', 'Visible languages');
    const languageSearch = element('input', 'language-search'); languageSearch.type = 'search'; languageSearch.placeholder = 'Search languages'; languageSearch.setAttribute('aria-label', 'Search languages');
    const languageList = element('div', 'language-options');
    const languageActions = element('div', 'language-actions'); languageActions.append(button('Show all', 'check-all', () => { visibleLanguages = new Set(items.map(i => i.language)); updateLanguages(); }), button('Source only', 'clear-all', () => { visibleLanguages = new Set([source]); updateLanguages(); }));
    languagePopup.append(languageSearch, languageList, languageActions, element('p', 'language-note', 'Source is always visible. Hidden languages still count toward completion.')); languageHost.append(languageButton, languagePopup); filterbar.append(languageHost);
    let languagesOpen = false;
    function closeLanguages() { languagesOpen = false; languagePopup.classList.add('hidden'); languageButton.setAttribute('aria-expanded', 'false'); }
    function toggleLanguages() { if (languagesOpen) { closeLanguages(); return; } closePopup?.(); closeMenu(); closePopup = closeLanguages; languagesOpen = true; languagePopup.classList.remove('hidden'); languageButton.setAttribute('aria-expanded', 'true'); languageSearch.value = ''; renderLanguageOptions(); languageSearch.focus(); }
    function displayedLanguages() { return items.filter(item => item.language === source || visibleLanguages?.has(item.language)); }
    function updateLanguages() { visibleLanguages.add(source); persist(); renderGrid(); renderLanguageOptions(); }
    function renderLanguageOptions() {
        const focusedLanguage = document.activeElement?.dataset.language;
        const scrollTop = languageList.scrollTop;
        languageList.replaceChildren();
        for (const item of items.filter(i => `${i.language} ${languageName(i.language)}`.toLowerCase().includes(languageSearch.value.toLowerCase()))) {
            const row = element('label', 'language-option'); const check = element('input'); check.type = 'checkbox'; check.checked = item.language === source || visibleLanguages?.has(item.language); check.disabled = item.language === source; check.dataset.language = item.language; check.setAttribute('aria-label', `Show ${item.language}`);
            check.addEventListener('change', () => { check.checked ? visibleLanguages.add(item.language) : visibleLanguages.delete(item.language); updateLanguages(); });
            const title = element('span', 'language-option-title'); title.append(element('span', '', item.language), element('small', '', languageName(item.language))); row.append(check, title); if (item.language === source) row.append(element('span', 'option-note', 'Source')); languageList.append(row);
        }
        if (!languageList.children.length) languageList.append(element('p', 'muted', 'No matching languages'));
        if (focusedLanguage) [...languageList.querySelectorAll('input')].find(input => input.dataset.language === focusedLanguage)?.focus();
        languageList.scrollTop = scrollTop;
    }
    languageSearch.addEventListener('input', renderLanguageOptions);
    languagePopup.addEventListener('keydown', event => {
        const controls = [languageSearch, ...languagePopup.querySelectorAll('input:not(:disabled):not(.language-search), button')]; const index = controls.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); closeLanguages(); languageButton.focus(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus(); }
        if (event.key === 'Tab') { event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus(); }
    });
    document.addEventListener('pointerdown', event => { if (!languageHost.contains(event.target)) closeLanguages(); });
    const sidebarToggle = button('Toggle language sidebar', 'layout-sidebar-right', () => { layout.classList.toggle('sidebar-hidden'); sidebarToggle.setAttribute('aria-pressed', String(!layout.classList.contains('sidebar-hidden'))); }); sidebarToggle.classList.add('icon-button'); sidebarToggle.setAttribute('aria-pressed', 'true'); filterbar.append(sidebarToggle);
    const rowbar = element('div', 'selectionbar hidden');
    rowbar.append(button('Rename', 'edit', () => singleAction('rename')), button('Copy', 'copy', () => singleAction('copy')), button('Delete', 'trash', () => { if (!selected.size) error('Select resources to delete.'); else send('deleteMany', { keys: [...selected] }); }));
    const selectionLabel = element('span', 'selection-count'); rowbar.prepend(selectionLabel); rowbar.append(button('Clear selection', 'close', () => { selected.clear(); renderGrid(); }));
    const notice = element('div', 'notice hidden'); notice.setAttribute('role', 'alert');
    const layout = element('div', 'layout');
    const scroll = element('div', 'grid-scroll'); const table = element('table'); table.setAttribute('aria-label', 'Resource translations'); scroll.append(table);
    const sidebar = element('aside', 'sidebar'); sidebar.setAttribute('aria-label', 'Language completion and missing keys');
    layout.append(scroll, sidebar);
    const status = element('div', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    app.append(toolbar, filterbar, rowbar, notice, layout, status, menu);
    // Measure soft wraps as well as explicit line breaks. Cap very large values at
    // twelve lines, retaining the full text and native scrolling inside the cell.
    function sizeInput(input) {
        const style = getComputedStyle(input);
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        const limit = Math.ceil(parseFloat(style.lineHeight) * 12 + padding + border);
        const previousScroll = input.scrollTop;
        input.classList.remove('is-scrollable');
        input.style.height = 'auto';
        // scrollHeight rounds to CSS pixels. A one-pixel allowance prevents a
        // fractional line box at Windows zoom/DPI from clipping the final line.
        const needed = input.scrollHeight + border + 1;
        input.style.height = `${Math.min(needed, limit)}px`;
        input.classList.toggle('is-scrollable', needed > limit);
        input.scrollTop = previousScroll;
    }
    const inputSizes = new WeakMap();
    const sizing = new ResizeObserver(entries => {
        for (const { target, contentRect } of entries) {
            const signature = `${contentRect.width}:${getComputedStyle(target).lineHeight}`;
            if (inputSizes.get(target) !== signature) { inputSizes.set(target, signature); sizeInput(target); }
        }
    });
    let sizingFrame;
    function refreshSizes() {
        cancelAnimationFrame(sizingFrame);
        sizingFrame = requestAnimationFrame(() => { for (const input of table.querySelectorAll('textarea')) sizeInput(input); });
    }
    // VS Code updates theme/font variables without necessarily changing column widths.
    const appearance = new MutationObserver(refreshSizes);
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    appearance.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    document.fonts.ready.then(refreshSizes);
    document.fonts.addEventListener('loadingdone', refreshSizes);
    function updateSelection() { selectionLabel.textContent = `${selected.size} selected`; rowbar.classList.toggle('hidden', !selected.size); }
    function languageName(language) { if (language === 'neutral') return 'Neutral'; try { return new Intl.DisplayNames([language], { type: 'language' }).of(language); } catch { return language; } }
    function error(text) { notice.replaceChildren(element('span', '', text), button('Open XML', 'code', 'text'), button('Dismiss', 'close', () => notice.classList.add('hidden'))); notice.classList.remove('hidden'); }
    function singleAction(action) { if (selected.size !== 1) { error('Select exactly one resource.'); return; } send(action, { key: [...selected][0] }); }
    function bulkAdd() {
        previewOpen = true;
        const pane = element('section', 'preview'); pane.setAttribute('role', 'dialog'); pane.setAttribute('aria-label', 'Add multiple resource keys');
        const bar = element('div', 'toolbar'); bar.append(element('h2', '', 'Add keys in every language'));
        const input = element('textarea'); input.rows = 12; input.placeholder = 'One key per line'; input.setAttribute('aria-label', 'Resource keys, one per line');
        const close = () => { pane.remove(); previewOpen = false; toolbar.inert = false; filterbar.inert = false; rowbar.inert = false; layout.inert = false; searchBox.focus(); };
        bar.append(button('Add keys', 'add', () => { const keys = input.value.split(/\r?\n/).map(k => k.trim()).filter(Boolean); send('addMany', { keys }); close(); }), button('Cancel', 'close', close));
        pane.append(bar, input); app.append(pane); toolbar.inert = true; filterbar.inert = true; rowbar.inert = true; layout.inert = true; input.focus();
        pane.addEventListener('keydown', event => { if (event.key === 'Escape') close(); if (event.key === 'Tab') { const controls = [...pane.querySelectorAll('button,textarea')]; const index = controls.indexOf(document.activeElement); event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus(); } });
    }
    function keys() { return [...new Set(items.flatMap(i => i.entries.map(e => e.key)))].sort((a, b) => descending ? b.localeCompare(a) : a.localeCompare(b)); }
    function sourceEntry(key) { return items.find(i => i.language === source)?.entries.find(e => e.key === key); }
    function missing(key, item) { const e = item.entries.find(e => e.key === key); return !e || (!e.readonly && !e.value.trim()); }
    function same(key, item) { const e = item.entries.find(e => e.key === key); const base = sourceEntry(key); return item.language !== source && !!e?.value && !!base && e.value === base.value; }
    function visible(key) {
        const entries = items.map(i => i.entries.find(e => e.key === key));
        if (search && ![key, ...entries.flatMap(e => e ? [e.value, e.comment] : [])].some(v => v.toLocaleLowerCase().includes(search.toLocaleLowerCase()))) return false;
        if (filter === 'missing') return !entries.some(e => e?.readonly) && items.some(i => i.language !== source && missing(key, i));
        if (filter === 'same') return items.some(i => same(key, i));
        if (filter === 'readonly') return entries.some(e => e?.readonly);
        return true;
    }
    function renderGrid() {
        rendering = true;
        const columns = displayedLanguages();
        languageButton.setAttribute('aria-label', `Visible languages (${columns.length}/${items.length})`);
        selected = new Set([...selected].filter(key => keys().includes(key)));
        // Preserve focused, unsent drafts when another view or language changes.
        const focused = document.activeElement;
        const draft = focused?.tagName === 'TEXTAREA' ? { id: focused.dataset.cell, value: focused.value, baseline: focused.dataset.baseline, start: focused.selectionStart, end: focused.selectionEnd, version: focused.dataset.version, scrollTop: focused.scrollTop } : undefined;
        sizing.disconnect();
        table.replaceChildren();
        const head = element('thead'); const headings = element('tr');
        const keyHeader = element('th', 'key'); keyHeader.scope = 'col'; keyHeader.append(element('span', '', 'Resource key'), element('span', 'column-meta', `${keys().length} entries`)); headings.append(keyHeader);
        columns.forEach(i => { const th = element('th', i.language === source ? 'source-column' : ''); th.scope = 'col'; const top = element('div', 'column-title'); top.append(element('span', '', languageName(i.language)), element('span', `role-label${i.language === source ? ' source-label' : ''}`, i.language === source ? 'Source' : 'Translation')); th.append(top, element('div', 'column-meta', `${i.language}${i.dirty ? ' · Unsaved' : ''}`)); headings.append(th); });
        if (showComments) { const th = element('th', 'comment-heading', 'Comment'); th.append(element('div', 'column-meta', 'Source context')); headings.append(th); }
        head.append(headings); table.append(head);
        const body = element('tbody');
        const displayed = keys().filter(visible);
        for (const [index, key] of displayed.entries()) {
            const row = element('tr', selected.has(key) ? 'selected' : ''); row.dataset.key = key;
            const cell = element('td', 'key'); const inner = element('div', 'key-content');
            const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(key); checkbox.setAttribute('aria-label', `Select ${key}`); checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(key) : selected.delete(key); row.classList.toggle('selected', checkbox.checked); updateSelection(); });
            const number = element('span', 'row-number', String(index + 1)); number.setAttribute('aria-hidden', 'true');
            const keyButton = element('button', 'key-name', key); keyButton.title = key; keyButton.addEventListener('click', () => { selected = new Set([key]); renderGrid(); }); inner.append(checkbox, number, keyButton); cell.append(inner); row.append(cell);
            for (const item of columns) row.append(editCell(key, item, 'value'));
            if (showComments) { const item = items.find(i => i.language === source); if (item) row.append(editCell(key, item, 'comment')); }
            body.append(row);
        }
        table.append(body);
        if (!displayed.length) { const empty = element('tr'); const cell = element('td', 'empty-state', search ? 'No matching resources' : 'No resources in this view'); cell.colSpan = columns.length + 1 + Number(showComments); empty.append(cell); body.append(empty); }
        if (draft) {
            const restored = [...table.querySelectorAll('textarea')].find(el => el.dataset.cell === draft.id);
            if (restored) { restored.value = draft.value; restored.dataset.baseline = draft.baseline; restored.dataset.version = draft.version; restored.focus(); restored.setSelectionRange(draft.start, draft.end); }
        }
        for (const input of table.querySelectorAll('textarea')) { sizeInput(input); sizing.observe(input); }
        if (draft) { const restored = [...table.querySelectorAll('textarea')].find(el => el.dataset.cell === draft.id); if (restored) restored.scrollTop = draft.scrollTop; }
        status.replaceChildren(element('span', '', `${displayed.length} resources · ${columns.length}/${items.length} languages visible`), element('span', 'status-hint', 'Tab / Enter to navigate · Shift + Enter for a new line'), element('span', 'save-state', items.some(i => i.dirty) ? `${items.filter(i => i.dirty).length} unsaved` : 'All changes saved'));
        saveButton.disabled = !items.some(i => i.dirty);
        updateSelection();
        renderSidebar();
        rendering = false;
    }
    function editCell(key, item, field) {
        const entry = item.entries.find(e => e.key === key);
        const groupReadOnly = items.some(i => i.entries.find(e => e.key === key)?.readonly);
        const isMissing = field === 'value' && missing(key, item) && !groupReadOnly;
        const isSame = field === 'value' && same(key, item);
        const cell = element('td', `${field === 'value' ? 'value' : 'comment'}${isMissing ? ' missing' : isSame ? ' same' : ''}${groupReadOnly ? ' readonly' : ''}${item.language === source ? ' source-column' : ''}`);
        const editor = element('div', 'cell-editor');
        const input = element('textarea'); input.rows = 1; input.value = entry?.[field] || '';
        input.dataset.cell = JSON.stringify([item.uri, key, field]); input.dataset.baseline = input.value; input.dataset.version = String(item.version);
        input.setAttribute('aria-label', `${key}, ${item.language}, ${field}${isMissing ? ', missing' : isSame ? ', same as source' : ''}`);
        input.readOnly = groupReadOnly || !!item.error; input.title = entry?.reason || (groupReadOnly ? 'This key contains a non-text or unsupported resource in another language.' : '');
        input.placeholder = isMissing ? '—' : '';
        input.addEventListener('input', () => sizeInput(input));
        input.addEventListener('focus', () => { if (input.value === input.dataset.baseline) input.dataset.version = String(items.find(i => i.uri === item.uri)?.version); });
        input.addEventListener('change', () => {
            if (rendering) return;
            if (input.value !== input.dataset.baseline) {
                const old = input.dataset.baseline;
                send('set', { uri: item.uri, key, field, value: input.value, expectedValue: old });
                input.dataset.baseline = input.value;
            }
        });
        input.addEventListener('keydown', event => {
            if (event.altKey && event.key === 'ArrowRight') { const indicator = editor.querySelector('.cell-indicator'); if (indicator) { event.preventDefault(); indicator.focus(); } return; }
            if (input.readOnly) return;
            if (event.key === 'Tab') {
                const cells = [...table.querySelectorAll('textarea:not([readonly])')]; const next = cells[cells.indexOf(input) + (event.shiftKey ? -1 : 1)];
                if (next) { event.preventDefault(); next.focus(); }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                event.preventDefault(); const cells = [...table.querySelectorAll('textarea:not([readonly])')]; const next = cells[cells.indexOf(input) + 1]; if (next) next.focus(); else input.blur();
            }
            if (event.key === 'Escape') { input.value = input.dataset.baseline; sizeInput(input); input.blur(); }
        });
        editor.append(input);
        if (field === 'value' && (groupReadOnly || isMissing || isSame)) {
            editor.classList.add('has-indicator');
            const state = groupReadOnly ? 'readonly' : isMissing ? 'missing' : 'same';
            const description = groupReadOnly ? `Read-only. ${input.title}` : isMissing ? 'Missing translation. Enter a value to complete this resource.' : 'Same as source. Check whether this value needs translation.';
            const indicator = element('span', `cell-indicator indicator-${state}`); indicator.tabIndex = 0; indicator.setAttribute('role', 'img'); indicator.setAttribute('aria-label', groupReadOnly ? 'Read-only resource' : isMissing ? 'Missing translation' : 'Same as source');
            indicator.append(icon(groupReadOnly ? 'lock' : isMissing ? 'circle-small-filled' : 'link'));
            const tooltip = element('div', 'cell-tooltip', description); tooltip.id = `cell-tooltip-${++nextTooltipId}`; tooltip.setAttribute('role', 'tooltip');
            indicator.setAttribute('aria-describedby', tooltip.id); input.setAttribute('aria-describedby', tooltip.id);
            indicator.addEventListener('keydown', event => { if (event.key === 'Escape' || (event.altKey && event.key === 'ArrowLeft')) { event.preventDefault(); input.focus(); } });
            editor.append(indicator, tooltip);
        }
        cell.append(editor);
        return cell;
    }
    function locate(key, language) {
        visibleLanguages.add(language);
        search = ''; filter = 'all'; searchBox.value = ''; filterBox.value = 'all'; persist(); renderGrid();
        const item = items.find(i => i.language === language);
        const cell = [...table.querySelectorAll('textarea')].find(el => el.dataset.cell === JSON.stringify([item?.uri, key, 'value']));
        cell?.scrollIntoView({ block: 'center', inline: 'nearest' }); cell?.focus();
    }
    function renderSidebar() {
        const heading = element('div', 'sidebar-heading'); heading.append(element('h2', '', 'LOCALIZATION'), element('span', 'count-badge', String(items.length))); sidebar.replaceChildren(heading);
        const allKeys = keys();
        for (const item of items) {
            const group = element('section', `language-status${item.language === source ? ' source-language' : ''}`);
            const missingKeys = allKeys.filter(k => missing(k, item) && !items.some(i => i.entries.find(e => e.key === k)?.readonly));
            const total = allKeys.filter(k => !items.some(i => i.entries.find(e => e.key === k)?.readonly)).length; const complete = total - missingKeys.length;
            const top = element('div', 'language-top'); top.append(element('span', 'language-code', item.language), element('span', 'language-percent', `${total ? Math.round(complete / total * 100) : 100}%`));
            group.append(top, element('div', 'language-name', languageName(item.language)));
            const progress = element('progress'); progress.max = Math.max(1, total); progress.value = total ? complete : 1; progress.setAttribute('aria-label', `${item.language}: ${complete} of ${total} translated`); group.append(progress);
            const summary = element('div', 'language-summary'); summary.append(icon(missingKeys.length ? 'circle-outline' : 'check'), element('span', '', item.language === source ? 'Source language' : missingKeys.length ? `${missingKeys.length} missing` : 'Complete')); group.append(summary);
            const sameCount = allKeys.filter(k => same(k, item)).length;
            if (sameCount) group.append(element('div', 'same-summary', `${sameCount} same as source`));
            sidebar.append(group);
        }
        const missingHeading = element('h2', 'missing-heading', 'NEEDS ATTENTION'); sidebar.append(missingHeading);
        let attention = 0;
        for (const item of items.filter(i => i.language !== source)) {
            const missingKeys = allKeys.filter(k => missing(k, item) && !items.some(i => i.entries.find(e => e.key === k)?.readonly));
            if (!missingKeys.length) continue;
            const label = element('div', 'attention-language', item.language); sidebar.append(label);
            missingKeys.forEach(key => { const link = button(key, 'circle-outline', () => locate(key, item.language)); link.classList.add('missing-link'); sidebar.append(link); attention++; });
        }
        if (!attention) { const complete = element('div', 'all-complete', 'No missing translations'); complete.prepend(icon('check-all')); sidebar.append(complete); }
    }
    function closePreview() { document.querySelector('.preview')?.remove(); previewOpen = false; }
    function preview(rows) {
        closePreview(); previewOpen = true;
        const pane = element('section', 'preview'); pane.setAttribute('role', 'dialog'); pane.setAttribute('aria-modal', 'true'); pane.setAttribute('aria-label', 'Review resource changes');
        const bar = element('div', 'toolbar'); bar.append(element('h2', '', `Review ${rows.length} changes`));
        const chosen = new Set(rows.map(row => row.id));
        const apply = button('Apply changes', 'check', 'applyPreview', () => ({ selection: [...chosen] })); apply.classList.add('primary');
        bar.append(apply, button('Discard', 'close', () => { send('cancelPreview'); closePreview(); toolbar.inert = false; filterbar.inert = false; rowbar.inert = false; layout.inert = false; }));
        pane.append(bar, element('p', 'muted', 'Existing values shown below will be replaced. Changes remain unsaved and can be undone. New external edits invalidate this preview.'));
        const body = element('div', 'preview-body'); const grid = element('table'); const header = element('tr'); ['Key / language / field', 'Before', 'After'].forEach(t => header.append(element('th', '', t))); grid.append(header);
        rows.forEach(row => { const tr = element('tr'); const key = element('td', '', `${row.key} · ${row.language} · ${row.field}`); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.setAttribute('aria-label', `Apply ${row.key}, ${row.language}, ${row.field}`); checkbox.addEventListener('change', () => checkbox.checked ? chosen.add(row.id) : chosen.delete(row.id)); key.prepend(checkbox); tr.append(key, element('td', 'before', row.before), element('td', 'after', row.after)); grid.append(tr); }); body.append(grid); pane.append(body); app.append(pane);
        toolbar.inert = true; filterbar.inert = true; rowbar.inert = true; layout.inert = true; apply.focus();
        pane.addEventListener('keydown', event => {
            if (event.key === 'Tab') { const btns = [...pane.querySelectorAll('button,input')]; const index = btns.indexOf(document.activeElement); event.preventDefault(); btns[(index + (event.shiftKey ? -1 : 1) + btns.length) % btns.length].focus(); }
        });
    }
    document.addEventListener('keydown', event => {
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && event.key === 'f') { event.preventDefault(); searchBox.focus(); searchBox.select(); }
        if (modifier && event.key === 's') { event.preventDefault(); document.activeElement?.blur(); send('save'); }
        if (modifier && event.key === 'Enter' && !previewOpen) { event.preventDefault(); document.activeElement?.blur(); send('add', { key: '' }); }
        // Draft editing uses the textarea undo stack; committed document edits use VS Code undo.
        if (modifier && (event.key === 'z' || event.key === 'y') && document.activeElement?.tagName !== 'TEXTAREA') { event.preventDefault(); send(event.key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
    });
    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'state') {
            source = msg.source; items = [...msg.items].sort((a, b) => a.language === source ? -1 : b.language === source ? 1 : a.language.localeCompare(b.language)); showComments = msg.showComments;
            if (!visibleLanguages) visibleLanguages = new Set(items.slice(0, 3).map(i => i.language));
            visibleLanguages.add(source);
            fileTitle.textContent = msg.name || 'Resources';
            fileSubtitle.textContent = `${items.length} languages · ${keys().length} resources`;
            sourceBox.setOptions(items.map(i => ({ value: i.language, label: i.language, description: languageName(i.language) })), source);
            if (languagesOpen) renderLanguageOptions();
            persist();
            commentToggle.setAttribute('aria-pressed', String(showComments));
            const errors = items.filter(i => i.error || i.warning); if (errors.length) error(errors.map(i => `${i.language}: ${i.error || i.warning}`).join(' · '));
            renderGrid();
            vscode.postMessage({ action: 'rendered', languageCount: items.length, resourceCount: keys().length });
        } else if (msg.type === 'error') error(msg.message);
        else if (msg.type === 'preview') preview(msg.rows);
        else if (msg.type === 'previewClosed') { closePreview(); toolbar.inert = false; filterbar.inert = false; rowbar.inert = false; layout.inert = false; searchBox.focus(); }
        else if (msg.type === 'ack') { busy = false; pump(); }
    });
    send('ready');
})();
