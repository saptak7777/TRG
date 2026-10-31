const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { trgDecode, trgEncode } = require('./codec');

/**
 * TrgFileSystemProvider
 * Allows VS Code Monaco to treat .trg as a native UTF-8 document.
 * Enables real Monaco line numbers, native tab dirty dot (●), and native VS Code editing and diffs.
 */
class TrgFileSystemProvider {
    constructor() {
        this._emitter = new vscode.EventEmitter();
        this.onDidChangeFile = this._emitter.event;
    }

    watch(uri) {
        const watcher = fs.watch(uri.fsPath, () => {
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        });
        return { dispose: () => watcher.close() };
    }

    stat(uri) {
        try {
            const stats = fs.statSync(uri.fsPath);
            const raw = fs.readFileSync(uri.fsPath);
            const decoded = trgDecode(raw);
            return {
                type: vscode.FileType.File,
                ctime: stats.ctimeMs,
                mtime: stats.mtimeMs,
                size: Buffer.byteLength(decoded.text, 'utf8')
            };
        } catch (e) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    readDirectory() { return []; }
    createDirectory() {}

    readFile(uri) {
        try {
            const rawData = fs.readFileSync(uri.fsPath);
            const decoded = trgDecode(rawData);
            return Buffer.from(decoded.text, 'utf8');
        } catch (err) {
            vscode.window.showErrorMessage(`TRG Read Error: ${err.message}`);
            return Buffer.from(`// Error reading TRG file: ${err.message}\n`, 'utf8');
        }
    }

    writeFile(uri, content, options) {
        try {
            const text = Buffer.from(content).toString('utf8');
            const binaryData = trgEncode(text);
            fs.writeFileSync(uri.fsPath, binaryData);
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
            vscode.window.setStatusBarMessage(`$(check) TRG: Saved ${text.length} chars (${binaryData.length} bytes)`, 3000);
        } catch (err) {
            vscode.window.showErrorMessage(`TRG Save Error (Fail Fast): ${err.message}`);
            throw err;
        }
    }

    delete(uri) { fs.unlinkSync(uri.fsPath); }
    rename(oldUri, newUri) { fs.renameSync(oldUri.fsPath, newUri.fsPath); }
}

/**
 * TrgCustomEditorProvider
 * Default viewer for .trg files in explorer.
 * Opens immediately without binary error dialogs.
 * Includes Tamil/Devanagari/Bengali font shaping to prevent empty box (tofu) glitches.
 */
function formatScriptName(scriptA, scriptB) {
    const getSingleName = (id) => {
        if (id === 1) return "English (ID 1)";
        if (id === 2) return "Bengali/Assamese (ID 2)";
        if (id === 3) return "Devanagari/Hindi (ID 3)";
        if (id === 4) return "Tamil (ID 4)";
        if (id === 5) return "Arabic (ID 5)";
        if (id === 0) return "None";
        return "Script ID " + id;
    };
    if (scriptB && scriptB > 0) {
        return getSingleName(scriptA) + " + " + getSingleName(scriptB);
    }
    return getSingleName(scriptA);
}

class TrgCustomEditorProvider {
    static register(context) {
        const provider = new TrgCustomEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            'trg.editor',
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false
            }
        );
    }

    constructor(context) {
        this.context = context;
    }

    async openCustomDocument(uri) {
        try {
            const rawBytes = fs.readFileSync(uri.fsPath);
            const decoded = trgDecode(rawBytes);
            return {
                uri,
                text: decoded.text,
                scriptA: decoded.scriptA,
                scriptB: decoded.scriptB,
                length: decoded.length,
                flags: decoded.flags,
                dispose: () => {}
            };
        } catch (err) {
            vscode.window.showErrorMessage(`TRG Read Error: ${err.message}`);
            return {
                uri,
                text: `// Error loading TRG file: ${err.message}\n`,
                scriptA: 0,
                scriptB: 0,
                length: 0,
                flags: 0,
                dispose: () => {}
            };
        }
    }

    async resolveCustomEditor(document, webviewPanel) {
        webviewPanel.webview.options = { enableScripts: true };

        const fileName = path.basename(document.uri.fsPath);
        const anchorName = formatScriptName(document.scriptA, document.scriptB);

        webviewPanel.webview.html = this.getHtmlForWebview(document.text, fileName, anchorName);

        // Auto disk-reloader
        let isSaving = false;
        const watcher = fs.watch(document.uri.fsPath, (eventType) => {
            if (eventType === 'change' && !isSaving) {
                try {
                    const raw = fs.readFileSync(document.uri.fsPath);
                    const decoded = trgDecode(raw);
                    webviewPanel.webview.postMessage({
                        command: 'reload',
                        text: decoded.text
                    });
                } catch (e) {}
            }
        });
        webviewPanel.onDidDispose(() => watcher.close());

        webviewPanel.webview.onDidReceiveMessage(message => {
            if (message.command === 'save') {
                try {
                    isSaving = true;
                    const encoded = trgEncode(message.text);
                    fs.writeFileSync(document.uri.fsPath, encoded);
                    setTimeout(() => { isSaving = false; }, 300);
                    webviewPanel.webview.postMessage({
                        command: 'saved',
                        bytes: encoded.length,
                        chars: message.text.length
                    });
                    vscode.window.setStatusBarMessage(`$(check) TRG: Saved ${message.text.length} chars (${encoded.length} bytes)`, 3000);
                } catch (err) {
                    vscode.window.showErrorMessage(`TRG Save Error (Fail Fast): ${err.message}`);
                }
            } else if (message.command === 'openNative') {
                vscode.commands.executeCommand('trg.openInEditor', document.uri);
            }
        });
    }

    getHtmlForWebview(initialText, fileName, anchorName) {
        const jsonText = JSON.stringify(initialText);
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>TRG Inspector</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
            font-family: var(--vscode-editor-font-family, 'Fira Code', 'JetBrains Mono', Consolas, monospace), 'Noto Sans Tamil', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Lohit Tamil', sans-serif;
            font-size: var(--vscode-editor-font-size, 14px);
            line-height: var(--vscode-editor-line-height, 1.5);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
            border-bottom: 1px solid var(--vscode-editorGroup-border, #333);
            padding: 6px 14px;
            font-size: 12px;
            user-select: none;
        }
        .badge {
            background: var(--vscode-badge-background, #0e639c);
            color: var(--vscode-badge-foreground, #fff);
            padding: 2px 8px;
            border-radius: 3px;
            font-weight: bold;
            margin-right: 8px;
        }
        .info { color: var(--vscode-descriptionForeground, #888); }
        .status { color: #89d185; font-size: 11px; margin-right: 10px; }
        .btn {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #ffffff);
            border: none;
            padding: 4px 10px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            margin-right: 8px;
        }
        .btn:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
        .save-btn {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #ffffff);
            border: none;
            padding: 4px 12px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
        }
        .save-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
        .btn-saved { background: #2ea043 !important; }
        .editor-container {
            display: flex;
            flex: 1;
            position: relative;
            overflow: hidden;
        }
        .line-numbers {
            width: 48px;
            padding: 10px 8px 10px 0;
            text-align: right;
            color: var(--vscode-editorLineNumber-foreground, #5a5a5a);
            background: var(--vscode-editor-background, #1e1e1e);
            border-right: 1px solid var(--vscode-editorGroup-border, #282828);
            font-family: inherit;
            font-size: inherit;
            line-height: inherit;
            user-select: none;
            overflow: hidden;
            white-space: pre;
        }
        textarea {
            flex: 1;
            background: transparent;
            color: inherit;
            font-family: inherit;
            font-size: inherit;
            line-height: inherit;
            border: none;
            outline: none;
            resize: none;
            padding: 10px 14px;
            white-space: pre;
            overflow: auto;
            tab-size: 4;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div>
            <span class="badge">TRG</span>
            <strong>${fileName}</strong> &nbsp;
            <span class="info">Scripts: ${anchorName} | 1-Byte Silicon Cells</span>
        </div>
        <div style="display:flex; align-items:center;">
            <button class="btn" id="openNativeBtn" title="Open in native Monaco text editor for native VS Code editing and diffs">
                Open in Native Editor
            </button>
            <span id="status" class="status"></span>
            <button class="save-btn" id="saveBtn">Save (Ctrl+S)</button>
        </div>
    </div>
    <div class="editor-container">
        <div class="line-numbers" id="lineNumbers">1</div>
        <textarea id="codeEditor" spellcheck="false"></textarea>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const editor = document.getElementById('codeEditor');
        const lineNumbers = document.getElementById('lineNumbers');
        const status = document.getElementById('status');
        const saveBtn = document.getElementById('saveBtn');
        const openNativeBtn = document.getElementById('openNativeBtn');

        editor.value = ${jsonText};
        updateLineNumbers();

        function updateLineNumbers() {
            const count = editor.value.split('\\n').length;
            let nums = '';
            for (let i = 1; i <= count; i++) {
                nums += i + '\\n';
            }
            lineNumbers.textContent = nums;
        }

        editor.addEventListener('input', () => {
            updateLineNumbers();
            status.textContent = '● Modified';
            status.style.color = '#e2c08d';
            saveBtn.textContent = '● Save (Ctrl+S)';
            saveBtn.classList.remove('btn-saved');
        });

        editor.addEventListener('scroll', () => {
            lineNumbers.scrollTop = editor.scrollTop;
        });

        // Tab key support (4 spaces)
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
                updateLineNumbers();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                doSave();
            }
        });

        saveBtn.addEventListener('click', doSave);
        openNativeBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'openNative' });
        });

        function doSave() {
            status.textContent = 'Saving...';
            status.style.color = '#75beff';
            vscode.postMessage({
                command: 'save',
                text: editor.value
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'reload') {
                if (editor.value !== message.text) {
                    editor.value = message.text;
                    updateLineNumbers();
                    status.textContent = '⟳ Updated from disk';
                    status.style.color = '#75beff';
                    setTimeout(() => { status.textContent = ''; }, 2000);
                }
            } else if (message.command === 'saved') {
                status.textContent = '✓ Saved (' + message.bytes + 'B)';
                status.style.color = '#89d185';
                saveBtn.textContent = '✓ Saved';
                saveBtn.classList.add('btn-saved');
                setTimeout(() => {
                    saveBtn.textContent = 'Save (Ctrl+S)';
                    saveBtn.classList.remove('btn-saved');
                    status.textContent = '';
                }, 2000);
            }
        });
    </script>
</body>
</html>`;
    }
}

function activate(context) {
    // 1. Register Virtual FileSystemProvider for Native Monaco Editing with AI Diffs
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('trg', new TrgFileSystemProvider(), {
            isCaseSensitive: true
        })
    );

    // 2. Register Custom Editor Provider for explorer click opening
    context.subscriptions.push(TrgCustomEditorProvider.register(context));

    // 3. Command: Open TRG in Native Monaco Editor
    context.subscriptions.push(
        vscode.commands.registerCommand('trg.openInEditor', async (uri) => {
            const targetUri = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
            if (!targetUri) return;
            const trgUri = vscode.Uri.from({
                scheme: 'trg',
                path: targetUri.fsPath
            });
            const doc = await vscode.workspace.openTextDocument(trgUri);
            await vscode.window.showTextDocument(doc, { preview: false });
        })
    );

    // 4. Command: Inspect Master Descriptor
    context.subscriptions.push(
        vscode.commands.registerCommand('trg.inspect', (uri) => {
            const targetUri = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
            if (!targetUri) return;
            try {
                const rawData = fs.readFileSync(targetUri.fsPath);
                const decoded = trgDecode(rawData);
                const anchorName = formatScriptName(decoded.scriptA, decoded.scriptB);
                vscode.window.showInformationMessage(
                    `TRG [${path.basename(targetUri.fsPath)}]: ${decoded.length} chars | Anchors: ${anchorName} | Total Size: ${rawData.length} bytes`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`TRG Inspect Error: ${err.message}`);
            }
        })
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
