/*
 * LinkDrop · Premiere 端 ExtendScript
 * 由面板通过 evalScript 调用；返回字符串 "OK..." 或 "ERR:..."。
 */

function ld_esc(s) {
    s = String(s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i), code = s.charCodeAt(i);
        if (c === '\\') out += '\\\\';
        else if (c === '"') out += '\\"';
        else if (code < 32 || code > 126) out += '\\u' + ('0000' + code.toString(16)).slice(-4);
        else out += c;
    }
    return '"' + out + '"';
}

function ld_ping() {
    return 'OK';
}

/** 当前项目信息（JSON 字符串） */
function ld_projectInfo() {
    try {
        if (!app.project) return '{"open":false}';
        var seq = app.project.activeSequence;
        return '{"open":true,"path":' + ld_esc(app.project.path || '') +
            ',"name":' + ld_esc(app.project.name || '') +
            ',"sequence":' + (seq ? ld_esc(seq.name) : 'null') + '}';
    } catch (e) {
        return '{"open":false,"error":' + ld_esc(e.toString()) + '}';
    }
}

function ld_getOrCreateBin(parent, name) {
    for (var i = 0; i < parent.children.numItems; i++) {
        var c = parent.children[i];
        if (c && c.type === ProjectItemType.BIN && c.name === name) return c;
    }
    return parent.createBin(name);
}

function ld_normPath(p) {
    return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function ld_findByPath(bin, fsPath) {
    var target = ld_normPath(fsPath);
    var found = null;
    for (var i = 0; i < bin.children.numItems; i++) {
        var c = bin.children[i];
        if (!c || c.type === ProjectItemType.BIN) continue;
        try {
            if (ld_normPath(c.getMediaPath()) === target) found = c;
        } catch (e) { /* 非媒体项 */ }
    }
    return found;
}

/**
 * 导入文件到指定素材箱。
 * @param filePath   绝对路径
 * @param binName    素材箱名称（空字符串 = 根目录）
 * @param insertMode "none" | "insert" | "overwrite"  是否放到当前序列的播放头位置
 * @param isAudio    纯音频文件则放到 A1
 */
function ld_import(filePath, binName, insertMode, isAudio) {
    try {
        if (!app.project) return 'ERR:请先在 Premiere 中打开或新建一个项目';
        var f = new File(filePath);
        if (!f.exists) return 'ERR:文件不存在：' + filePath;

        var root = app.project.rootItem;
        var bin = binName ? ld_getOrCreateBin(root, binName) : root;

        var item = ld_findByPath(bin, f.fsName);
        if (!item) {
            app.project.importFiles([f.fsName], true, bin, false);
            item = ld_findByPath(bin, f.fsName);
        }
        if (!item) return 'ERR:Premiere 未能导入该文件（格式可能不受支持）';

        var placed = '';
        if (insertMode && insertMode !== 'none') {
            var seq = app.project.activeSequence;
            if (!seq) {
                placed = '|NOSEQ';
            } else {
                var t = seq.getPlayerPosition();
                var track = isAudio ? seq.audioTracks[0] : seq.videoTracks[0];
                if (insertMode === 'overwrite') track.overwriteClip(item, t.seconds);
                else track.insertClip(item, t.seconds);
                placed = '|PLACED';
            }
        }
        try { item.select(); } catch (e2) { /* 旧版本没有 select */ }
        return 'OK' + placed;
    } catch (e) {
        return 'ERR:' + e.toString();
    }
}
