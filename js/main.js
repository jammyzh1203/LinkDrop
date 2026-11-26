/* LinkDrop 面板 UI 逻辑 */
(function () {
  'use strict';

  var DL = window.LinkDropDL;
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------ Premiere 桥接

  var IN_CEP = !!window.__adobe_cep__;

  function toJsLiteral(v) {
    return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function evalHost(fn, args) {
    var script = fn + '(' + (args || []).map(toJsLiteral).join(',') + ')';
    return new Promise(function (resolve) {
      if (!IN_CEP) return resolve('ERR:不在 Premiere 中运行');
      window.__adobe_cep__.evalScript(script, function (r) { resolve(String(r)); });
    });
  }

  function projectInfo() {
    return evalHost('ld_projectInfo').then(function (r) {
      try { return JSON.parse(r); } catch (e) { return { open: false }; }
    });
  }

  function syncTheme() {
    try {
      var env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
      var c = env.appSkinInfo.panelBackgroundColor.color;
      var rgb = [c.red, c.green, c.blue].map(Math.round);
      document.documentElement.style.setProperty('--bg', 'rgb(' + rgb.join(',') + ')');
    } catch (e) { /* 浏览器预览时忽略 */ }
  }

  // ------------------------------------------------------------ 设置

  var DEFAULTS = {
    quality: '1080', place: 'none', binName: '网络素材', dirMode: 'project',
    customDir: DL.defaultDownloadDir(), cookies: '', concurrency: '2',
    autoFix: true, autoStart: true
  };
  var S = {};
  (function load() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('linkdrop.settings') || '{}'); } catch (e) { /* */ }
    Object.keys(DEFAULTS).forEach(function (k) { S[k] = (k in saved) ? saved[k] : DEFAULTS[k]; });
  })();
  function save() {
    try { localStorage.setItem('linkdrop.settings', JSON.stringify(S)); } catch (e) { /* */ }
  }

  function bindSetting(id, key, isCheck) {
    var el = $(id);
    if (isCheck) el.checked = !!S[key]; else el.value = S[key];
    el.addEventListener('change', function () {
      S[key] = isCheck ? el.checked : el.value;
      save();
      renderSettings();
    });
  }
  bindSetting('quality', 'quality');
  bindSetting('place', 'place');
  bindSetting('binName', 'binName');
  bindSetting('dirMode', 'dirMode');
  bindSetting('cookies', 'cookies');
  bindSetting('concurrency', 'concurrency');
  bindSetting('autoFix', 'autoFix', true);
  bindSetting('autoStart', 'autoStart', true);

  function renderSettings() {
    $('customDirRow').classList.toggle('hidden', S.dirMode !== 'custom');
    $('customDir').textContent = S.customDir;
    $('customDir').title = S.customDir;
    (tasks || []).forEach(function (t) { update(t, {}); }); // 登录信息改了，刷新错误卡片里的按钮
    pump();
  }

  $('settingsBtn').onclick = function () {
    var open = $('settings').classList.toggle('hidden') === false;
    $('settingsBtn').classList.toggle('on', open);
  };

  $('pickDir').onclick = function () {
    if (!window.cep || !window.cep.fs) return;
    var r = window.cep.fs.showOpenDialog(false, true, '选择下载文件夹', S.customDir);
    if (r && r.data && r.data.length) {
      S.customDir = r.data[0];
      save();
      renderSettings();
    }
  };

  // ------------------------------------------------------------ 组件检测

  var tools = { ytdlp: null, ffmpeg: null, jsRuntime: null };
  var busyInstall = false;

  function setStatus(text) { $('status').textContent = text; }

  function showBanner(html, kind, btnText, onClick) {
    var b = $('banner');
    b.className = 'banner' + (kind === 'err' ? ' err' : '');
    b.innerHTML = '<span>' + html + '</span>';
    if (btnText) {
      var btn = document.createElement('button');
      btn.className = 'small';
      btn.textContent = btnText;
      btn.onclick = onClick;
      b.appendChild(btn);
    }
  }
  function hideBanner() { $('banner').className = 'banner hidden'; }

  function toolRow(name, ok, level, value) {
    return '<li><span class="dot ' + level + '"></span><b>' + name + '</b><span class="v" title="' +
      esc(value) + '">' + esc(value) + '</span></li>';
  }

  function detect() {
    setStatus('正在检测组件…');
    return DL.detect().then(function (t) {
      tools = t;
      var rows = [];
      rows.push(t.ytdlp && t.ytdlpVersion
        ? toolRow('yt-dlp', true, 'ok', t.ytdlpVersion + ' · ' + t.ytdlp)
        : toolRow('yt-dlp', false, 'err', t.ytdlp ? '无法运行：' + (t.ytdlpError || '') : '未安装（必需）'));
      rows.push(t.ffmpeg
        ? toolRow('ffmpeg', true, 'ok', t.ffmpeg)
        : toolRow('ffmpeg', false, 'warn', '未找到：只能下载低清单文件，且无法转码'));
      rows.push(t.jsRuntime
        ? toolRow('JS 运行时', true, 'ok', t.jsRuntime.name + ' · ' + t.jsRuntime.path)
        : toolRow('JS 运行时', false, 'warn', '未找到 Deno/Node：YouTube 可能解析失败'));
      $('toolList').innerHTML = rows.join('');

      if (!t.ytdlp || !t.ytdlpVersion) {
        showBanner('首次使用需要安装下载引擎 yt-dlp（约 35 MB，来自官方 GitHub）', 'warn', '一键安装', installComponents);
        setStatus('缺少 yt-dlp');
      } else if (!t.ffmpeg) {
        showBanner('未找到 ffmpeg，高清视频需要它来合并音视频。请安装 ffmpeg 后点「重新检测」。', 'warn', '重新检测', detect);
        setStatus('yt-dlp ' + t.ytdlpVersion + ' · 缺少 ffmpeg');
      } else {
        hideBanner();
        setStatus('就绪 · yt-dlp ' + t.ytdlpVersion);
      }
      pump();
      return t;
    });
  }

  function installComponents() {
    if (busyInstall) return Promise.resolve();
    busyInstall = true;
    $('installBtn').disabled = true;
    var steps = Promise.resolve();
    var needYt = !tools.ytdlp || !tools.ytdlpVersion;
    var needJs = !tools.jsRuntime;
    if (!needYt && !needJs) needYt = true; // 「修复」：重新下载 yt-dlp
    if (needYt) {
      steps = steps.then(function () {
        showBanner('正在下载 yt-dlp… 0%', 'warn');
        return DL.installYtDlp(function (p) { showBanner('正在下载 yt-dlp… ' + Math.round(p * 100) + '%', 'warn'); });
      });
    }
    if (needJs) {
      steps = steps.then(function () {
        showBanner('正在下载 Deno（YouTube 解析需要）… 0%', 'warn');
        return DL.installDeno(function (p) { showBanner('正在下载 Deno（YouTube 解析需要）… ' + Math.round(p * 100) + '%', 'warn'); });
      });
    }
    return steps.then(function () {
      showBanner('首次运行 yt-dlp 需要几秒钟初始化…', 'warn');
      return detect();
    }).catch(function (e) {
      showBanner('安装失败：' + esc(e.message) + '。请检查网络后重试。', 'err', '重试', installComponents);
    }).then(function () {
      busyInstall = false;
      $('installBtn').disabled = false;
    });
  }

  $('installBtn').onclick = installComponents;
  $('redetectBtn').onclick = detect;
  $('updateBtn').onclick = function () {
    if (!tools.ytdlp) return installComponents();
    var btn = $('updateBtn');
    btn.disabled = true;
    btn.textContent = '更新中…';
    DL.updateYtDlp(tools.ytdlp, function (p) { btn.textContent = '下载中 ' + Math.round(p * 100) + '%'; }).then(function (msg) {
      setStatus(msg);
      return detect();
    }).catch(function (e) {
      setStatus('更新失败：' + e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '更新 yt-dlp';
    });
  };

  // ------------------------------------------------------------ 任务队列

  var tasks = [];
  var seq = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    if (!sec) return '';
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var mm = (h ? String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
    return h ? h + ':' + mm : mm;
  }

  function newTask(url) {
    return {
      id: ++seq, url: url, site: DL.siteOf(url), title: url, thumb: '', duration: 0,
      state: 'queued', text: '排队中', percent: 0, files: [], quality: S.quality, place: S.place
    };
  }

  function addUrls(text) {
    var urls = DL.extractUrls(text);
    if (!urls.length) {
      var w = $('inputWrap');
      w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
      setStatus('没有识别到链接');
      return false;
    }
    urls.forEach(function (url) {
      var t = newTask(url);
      tasks.unshift(t);
      mount(t);
    });
    $('url').value = '';
    autoGrow();
    pump();
    return true;
  }

  function running() {
    return tasks.filter(function (t) { return t.state === 'downloading' || t.state === 'starting'; }).length;
  }

  function pump() {
    if (!tools.ytdlp || !tools.ytdlpVersion) return;
    var limit = parseInt(S.concurrency, 10) || 1;
    var queued = tasks.filter(function (t) { return t.state === 'queued'; }).reverse(); // 先进先出
    while (running() < limit && queued.length) start(queued.shift());
  }

  function resolveOutDir() {
    if (S.dirMode === 'custom') return Promise.resolve(S.customDir || DL.defaultDownloadDir());
    return projectInfo().then(function (p) {
      if (p && p.path) return DL.pathJoin(DL.dirname(p.path), 'LinkDrop 素材');
      return DL.defaultDownloadDir();
    });
  }

  function start(t) {
    t.state = 'starting';
    t.files = [];
    t.errorKind = null;
    t.rawError = '';
    var using = S.cookies && !DL.yueliuCode(t.url) ? '（使用 ' + DL.BROWSER_NAMES[S.cookies] + ' 登录信息）' : '';
    update(t, { text: '解析链接' + using + '…', percent: 0, indeterminate: true });
    resolveOutDir().then(function (outDir) {
      if (t.state !== 'starting') return; // 期间被取消
      t.state = 'downloading';
      t.outDir = outDir;
      if (DL.yueliuCode(t.url)) return startYueliu(t, outDir);
      t.handle = DL.download(tools.ytdlp, t.url, {
        outDir: outDir,
        quality: t.quality,
        cookiesBrowser: S.cookies,
        tools: tools
      }, downloadHandlers(t));
    });
  }

  function downloadHandlers(t, fixedMeta) {
    return {
      onMeta: function (m) {
        if (fixedMeta) return update(t, { text: '准备下载…' });
        if (m.title) t.title = m.title;
        if (m.thumbnail) t.thumb = m.thumbnail;
        if (m.duration) t.duration = m.duration;
        if (m.extractor_key && t.site.indexOf('.') !== -1) t.site = m.extractor_key;
        update(t, { text: '准备下载…' });
      },
      onProgress: function (p) {
        var label = t.quality === 'audio' ? '下载音频' : (p.part === 'audio' && p.partIndex > 1 ? '下载音轨' : '下载视频');
        var txt = label + ' ' + (p.percent != null ? p.percent.toFixed(1) + '%' : '');
        if (p.speed && !/unknown|N\/?A/i.test(p.speed)) txt += ' · ' + p.speed;
        if (p.eta && !/unknown|N\/?A/i.test(p.eta) && p.eta !== '00:00') txt += ' · 剩余 ' + p.eta;
        update(t, { text: txt, percent: p.percent || 0, indeterminate: false });
      },
      onStage: function (s) { setState(t, 'processing'); update(t, { text: s, indeterminate: true }); },
      onDone: function (files) {
        t.handle = null;
        t.files = files;
        setState(t, 'processing');
        postProcess(t).then(pump, pump);
      },
      onError: function (msg, kind, raw) {
        t.handle = null;
        t.errorKind = kind || null;
        t.rawError = raw || '';
        setState(t, kind === 'cancelled' ? 'cancelled' : 'error');
        update(t, { text: msg.replace(/该网站/g, t.site), indeterminate: false });
        pump();
      }
    };
  }

  /**
   * 阅流分享：先读文件列表，第一个文件由当前任务下载，其余文件各自拆成一个任务排在它下面。
   * 下载的是阅流云端转码流（免登录可看的最高清晰度），每次开始时重新取地址（地址 1 小时过期）。
   */
  function startYueliu(t, outDir) {
    update(t, { text: '读取阅流分享…', indeterminate: true });
    DL.yueliuList(t.url).then(function (share) {
      if (t.state !== 'downloading') return;
      var files = share.files;
      var mine = t.ylId ? files.filter(function (f) { return f.id === t.ylId; }) : files;
      if (!mine.length) throw new Error(t.ylId ? '这个文件已不在分享里' : '分享里没有文件');
      var f = mine[0];
      if (!t.ylId) {
        t.ylId = f.id;
        var idx = tasks.indexOf(t);
        var anchor = t.el;
        files.slice(1).forEach(function (o) {
          var c = newTask(t.url);
          c.ylId = o.id; c.title = o.name; c.thumb = o.thumb; c.duration = o.duration;
          c.quality = t.quality; c.place = t.place;
          tasks.splice(idx + 1, 0, c); // 数组里越靠后越先下载，所以倒插，保持列表顺序
          mount(c);
          $('list').insertBefore(c.el, anchor.nextSibling);
          anchor = c.el;
        });
        if (files.length > 1) setStatus('阅流分享「' + (share.title || share.code) + '」共 ' + files.length + ' 个文件');
      }
      t.title = f.name; t.thumb = f.thumb; t.duration = f.duration;
      if (!f.stream) {
        throw new Error(f.type === 'video'
          ? '阅流还没转码完这个视频，稍后重试'
          : '「' + f.name + '」不是视频，下载原文件需要登录阅流，暂不支持');
      }
      var res = f.stream.width && f.stream.height ? f.stream.width + '×' + f.stream.height : '';
      update(t, { text: '准备下载' + (res ? '（阅流转码 ' + res + '）' : '') + '…' });
      t.handle = DL.download(tools.ytdlp, f.stream.url, {
        outDir: outDir, outName: f.base, quality: 'best', tools: tools
      }, downloadHandlers(t, true));
    }).catch(function (e) {
      if (t.state !== 'downloading') return;
      t.handle = null;
      setState(t, 'error');
      update(t, { text: e.message, indeterminate: false });
      pump();
    });
  }

  function postProcess(t) {
    var chain = Promise.resolve();
    var out = [];
    t.files.forEach(function (file) {
      chain = chain.then(function () { return fixCompat(t, file); }).then(function (f) { out.push(f); });
    });
    return chain.then(function () {
      t.files = out;
      return importAll(t);
    }).catch(function (e) {
      setState(t, e.message === '已取消' ? 'cancelled' : 'error');
      update(t, { text: e.message, indeterminate: false });
    });
  }

  function fixCompat(t, file) {
    if (!S.autoFix || !tools.ffmpeg || t.quality === 'audio') return Promise.resolve(file);
    update(t, { text: '检查编码…', indeterminate: true });
    return DL.probe(tools.ffmpeg, file).then(function (info) {
      var need = DL.needsTranscode(info);
      if (!need.any) return file;
      if (!info.duration) info.duration = t.duration;
      var what = need.video ? info.vcodec.toUpperCase() + ' → H.264' : info.acodec + ' → AAC';
      update(t, { text: '转码 ' + what + '…', percent: 0, indeterminate: !info.duration });
      var job = DL.makePremiereFriendly(tools.ffmpeg, file, info, function (pct) {
        update(t, { text: '转码 ' + what + ' ' + pct.toFixed(0) + '%', percent: pct, indeterminate: false });
      });
      t.handle = job;
      return job.promise.then(function (f) { t.handle = null; return f; });
    });
  }

  function importAll(t) {
    setState(t, 'importing');
    update(t, { text: '导入 Premiere…', indeterminate: true });
    var chain = Promise.resolve();
    var notes = [];
    t.files.forEach(function (file) {
      chain = chain.then(function () {
        var isAudio = /\.(m4a|mp3|aac|wav|opus|ogg|flac)$/i.test(file);
        return evalHost('ld_import', [file, S.binName || '', t.place, isAudio]).then(function (r) {
          if (r.indexOf('OK') !== 0) throw new Error(r.replace(/^ERR:/, '') || 'Premiere 无响应');
          if (r.indexOf('NOSEQ') !== -1) notes.push('没有打开的序列，未放到时间轴');
        });
      });
    });
    return chain.then(function () {
      setState(t, 'done');
      var where = S.binName ? '「' + S.binName + '」素材箱' : '项目根目录';
      update(t, { text: '已导入' + where + (notes.length ? ' · ' + notes[0] : ''), indeterminate: false });
    }).catch(function (e) {
      t.importFailed = true;
      setState(t, 'error');
      update(t, { text: '文件已下载，但导入失败：' + e.message, indeterminate: false });
    });
  }

  // ------------------------------------------------------------ 渲染

  function setState(t, s) { t.state = s; }

  function mount(t) {
    var el = document.createElement('div');
    el.className = 'task';
    el.innerHTML =
      '<div class="thumb"><img alt="" referrerpolicy="no-referrer"><span class="dur hidden"></span></div>' +
      '<div class="body"><div class="title"></div>' +
      '<div class="meta"><span class="site"></span><span class="state"></span></div>' +
      '<div class="fix hidden"></div>' +
      '<div class="progress"><i></i></div></div>' +
      '<div class="actions"></div>';
    t.el = el;
    var img = el.querySelector('img');
    img.onerror = function () { img.style.visibility = 'hidden'; };
    $('list').insertBefore(el, $('list').firstChild);
    update(t, {});
  }

  var ACTIONS = {
    cancel: { icon: 'i-x', title: '取消' },
    retry: { icon: 'i-retry', title: '重试' },
    reveal: { icon: 'i-folder', title: '在访达 / 资源管理器中显示' },
    remove: { icon: 'i-x', title: '移出列表' }
  };

  function update(t, patch) {
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    var el = t.el;
    if (!el) return;
    var active = ['starting', 'downloading', 'processing', 'importing'].indexOf(t.state) !== -1;
    var fixable = t.state === 'error' && FIXABLE.indexOf(t.errorKind) !== -1;
    el.className = 'task ' + t.state + (t.indeterminate && active ? ' indeterminate' : '') + (fixable ? ' fixable' : '');
    renderFix(t, el.querySelector('.fix'));
    el.querySelector('.title').textContent = t.title;
    el.querySelector('.title').title = t.title + '\n' + t.url;
    var site = el.querySelector('.site');
    site.textContent = t.site;
    site.className = 'site ' + t.site;
    el.querySelector('.state').textContent = t.text;
    el.querySelector('.progress i').style.width = (t.percent || 0) + '%';
    var img = el.querySelector('img');
    if (t.thumb && img.getAttribute('src') !== t.thumb) { img.style.visibility = ''; img.src = t.thumb; }
    var dur = el.querySelector('.dur');
    dur.textContent = fmtDur(t.duration);
    dur.classList.toggle('hidden', !t.duration);

    var acts = [];
    if (t.state === 'queued' || active) { if (t.state !== 'importing') acts.push('cancel'); }
    if (t.state === 'error' || t.state === 'cancelled') acts.push('retry');
    if (t.files && t.files.length && !active) acts.push('reveal');
    if (!active && t.state !== 'queued') acts.push('remove');
    var key = acts.join(',');
    var box = el.querySelector('.actions');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = acts.map(function (a) {
        return '<button class="ghost" data-act="' + a + '" title="' + ACTIONS[a].title + '"><svg><use href="#' + ACTIONS[a].icon + '"/></svg></button>';
      }).join('');
      box.querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { act(t, b.dataset.act); };
      });
    }
    refreshChrome();
  }

  // ------------------------------------------------------------ 一键修复

  var FIXABLE = ['auth', 'cookies', 'js', 'ffmpeg', 'dir'];
  var browsers = DL.installedBrowsers();

  function chip(label, attrs, extraClass) {
    var a = Object.keys(attrs).map(function (k) { return 'data-' + k + '="' + esc(attrs[k]) + '"'; }).join(' ');
    return '<button class="chip ' + (extraClass || '') + '" ' + a + '>' + esc(label) + '</button>';
  }

  function renderFix(t, box) {
    var kind = t.state === 'error' ? t.errorKind : null;
    var key = kind ? kind + '|' + S.cookies : '';
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    var html = '';
    if (kind === 'auth' || kind === 'cookies') {
      var list = browsers.filter(function (b) { return !(kind === 'cookies' && b.id === S.cookies); });
      html = list.map(function (b) {
        var cur = b.id === S.cookies;
        return chip(cur ? b.name + ' 再试一次' : b.name, { fix: 'browser', b: b.id }, cur ? 'cur' : '');
      }).join('');
      if (!list.length) html = '<span class="dim">没有找到可用的浏览器</span>';
      html += chip('更多设置', { fix: 'settings', target: 'cookiesRow' }, 'plain');
    } else if (kind === 'js') {
      html = chip('安装组件并重试', { fix: 'install' }) + chip('查看组件', { fix: 'settings', target: 'toolsBox' }, 'plain');
    } else if (kind === 'ffmpeg') {
      html = chip('查看组件', { fix: 'settings', target: 'toolsBox' }, 'plain');
    } else if (kind === 'dir') {
      html = chip('修改保存位置', { fix: 'settings', target: 'dirRow' }, 'plain');
    }
    box.innerHTML = html;
    box.classList.toggle('hidden', !html);
    box.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        var d = b.dataset;
        if (d.fix === 'browser') useBrowser(d.b);
        else if (d.fix === 'install') installComponents().then(function () { retryKinds(['js']); });
        else if (d.fix === 'settings') openSettings(d.target);
      };
    });
  }

  /** 选定浏览器 → 写入设置 → 重试所有因登录问题失败的任务 */
  function useBrowser(id) {
    S.cookies = id;
    $('cookies').value = id;
    save();
    if (DL.IS_MAC && /chrome|edge|brave/.test(id)) {
      setStatus('若弹出钥匙串授权「' + DL.BROWSER_NAMES[id] + ' Safe Storage」，请点「始终允许」');
    } else {
      setStatus('已改用 ' + DL.BROWSER_NAMES[id] + ' 的登录信息');
    }
    retryKinds(['auth', 'cookies']);
  }

  function retryKinds(kinds) {
    tasks.forEach(function (t) {
      if (t.state === 'error' && kinds.indexOf(t.errorKind) !== -1) act(t, 'retry');
    });
  }

  /** 展开设置面板并高亮某一项 */
  function openSettings(targetId) {
    $('settings').classList.remove('hidden');
    $('settingsBtn').classList.add('on');
    var el = targetId && $(targetId);
    if (!el) return;
    if (targetId === 'dirRow' && S.dirMode !== 'custom') { S.dirMode = 'custom'; $('dirMode').value = 'custom'; save(); renderSettings(); }
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    var field = el.querySelector('select, input');
    if (field) field.focus();
  }

  function act(t, a) {
    if (a === 'cancel') {
      if (t.handle) t.handle.cancel();
      else { setState(t, 'cancelled'); update(t, { text: '已取消', indeterminate: false }); }
      if (t.state === 'starting') { setState(t, 'cancelled'); update(t, { text: '已取消' }); }
    } else if (a === 'retry') {
      if (t.importFailed && t.files.length && t.files.every(DL.isFile)) {
        t.importFailed = false;
        importAll(t);
      } else {
        setState(t, 'queued');
        update(t, { text: '排队中', percent: 0 });
        pump();
      }
    } else if (a === 'reveal') {
      DL.reveal(t.files[0]);
    } else if (a === 'remove') {
      t.el.remove();
      tasks.splice(tasks.indexOf(t), 1);
      refreshChrome();
    }
  }

  function refreshChrome() {
    $('empty').classList.toggle('hidden', tasks.length > 0);
    var finished = tasks.some(function (t) { return t.state === 'done' || t.state === 'cancelled'; });
    $('clearBtn').classList.toggle('hidden', !finished);
  }

  $('clearBtn').onclick = function () {
    tasks.slice().forEach(function (t) {
      if (t.state === 'done' || t.state === 'cancelled') act(t, 'remove');
    });
  };

  // ------------------------------------------------------------ 输入

  var input = $('url');
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(96, input.scrollHeight) + 'px';
    input.style.overflowY = input.scrollHeight > 96 ? 'auto' : 'hidden';
  }
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addUrls(input.value);
    }
  });
  function afterPaste() {
    autoGrow();
    if (S.autoStart && DL.extractUrls(input.value).length) addUrls(input.value);
  }
  // 右键菜单粘贴等原生粘贴
  input.addEventListener('paste', function () { setTimeout(afterPaste, 0); });

  // ------------------------------------------------------------ 编辑快捷键
  // Premiere 默认把 ⌘V / ⌘C / ⌘A 等快捷键留给自己的「编辑」菜单，面板里的输入框收不到。
  // 先向宿主登记这些按键，让它们转发给面板，再由面板自己完成粘贴 / 复制 / 全选。
  (function registerEditKeys() {
    var cep = window.__adobe_cep__;
    if (!cep || !cep.registerKeyEventsInterest) return;
    // macOS 虚拟键码：A=0 Z=6 X=7 C=8 V=9；Windows：A=65 C=67 V=86 X=88 Z=90
    var keys = DL.IS_MAC
      ? [0, 6, 7, 8, 9].map(function (k) { return { keyCode: k, metaKey: true }; })
        .concat([{ keyCode: 6, metaKey: true, shiftKey: true }])
      : [65, 67, 86, 88, 90].map(function (k) { return { keyCode: k, ctrlKey: true }; })
        .concat([{ keyCode: 90, ctrlKey: true, shiftKey: true }]);
    try { cep.registerKeyEventsInterest(JSON.stringify(keys)); } catch (e) { /* 旧版本 CEP */ }
  })();

  function isTextField(el) {
    return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'));
  }

  // 用 insertText 保留撤销记录；不支持时退回直接改值
  function insertText(field, text) {
    var ok = false;
    try { ok = document.execCommand(text ? 'insertText' : 'delete', false, text); } catch (e) { ok = false; }
    if (!ok) {
      field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.addEventListener('keydown', function (e) {
    var mod = DL.IS_MAC ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey) return;
    var k = (e.key || '').toLowerCase();
    var el = document.activeElement;
    var field = isTextField(el) ? el : null;
    if (k === 'v') {
      e.preventDefault();
      var text = DL.readClipboard();
      if (!field) { // 焦点不在输入框：剪贴板里有链接就直接下载
        if (DL.extractUrls(text).length) addUrls(text);
        return;
      }
      if (field.tagName === 'INPUT') text = text.replace(/\s*[\r\n]+\s*/g, ' ');
      insertText(field, text);
      if (field === input) afterPaste();
    } else if (field && (k === 'c' || k === 'x')) {
      var sel = field.value.slice(field.selectionStart, field.selectionEnd);
      if (!sel) return;
      e.preventDefault();
      DL.writeClipboard(sel);
      if (k === 'x') insertText(field, '');
    } else if (field && k === 'a') {
      e.preventDefault();
      field.select();
    } else if (field && k === 'z') {
      e.preventDefault();
      document.execCommand(e.shiftKey ? 'redo' : 'undo');
    }
  });
  $('goBtn').onclick = function () { addUrls(input.value); };
  $('pasteBtn').onclick = function () {
    var text = DL.readClipboard();
    if (!DL.extractUrls(text).length) {
      setStatus('剪贴板里没有链接');
      return;
    }
    if (S.autoStart) addUrls(text);
    else { input.value = text.trim(); autoGrow(); input.focus(); }
  };

  // 拖放链接
  var dragDepth = 0;
  document.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; $('dropMask').classList.remove('hidden'); });
  document.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; $('dropMask').classList.add('hidden'); } });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    $('dropMask').classList.add('hidden');
    var dt = e.dataTransfer;
    var text = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
    addUrls(text);
  });

  // ------------------------------------------------------------ 启动

  syncTheme();
  if (IN_CEP) {
    try {
      window.__adobe_cep__.addEventListener('com.adobe.csxs.events.ThemeColorChanged', syncTheme);
    } catch (e) { /* */ }
  }
  renderSettings();
  refreshChrome();
  detect();
})();
