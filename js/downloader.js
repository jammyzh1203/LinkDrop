/*
 * LinkDrop 下载核心：封装 yt-dlp / ffmpeg。
 * 纯 Node 代码，既能在 CEP 面板（mixed-context）里用，也能在命令行 node 下单独测试。
 */
(function () {
  'use strict';

  var req = (typeof require === 'function') ? require
    : (typeof window !== 'undefined' && window.cep_node ? window.cep_node.require : null);
  var fs = req('fs');
  var path = req('path');
  var os = req('os');
  var cp = req('child_process');
  var https = req('https');

  var IS_WIN = process.platform === 'win32';
  var IS_MAC = process.platform === 'darwin';
  var HOME = os.homedir();
  var DATA_DIR = process.env.LINKDROP_DATA_DIR || (IS_WIN
    ? path.join(process.env.APPDATA || HOME, 'LinkDrop')
    : path.join(HOME, 'Library', 'Application Support', 'LinkDrop'));
  var BIN_DIR = path.join(DATA_DIR, 'bin');
  var EXE = IS_WIN ? '.exe' : '';

  // ---------------------------------------------------------------- 工具查找

  function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch (e) { return false; }
  }

  function listDirs(parent) {
    try {
      return fs.readdirSync(parent).map(function (n) { return path.join(parent, n); });
    } catch (e) { return []; }
  }

  function searchDirs() {
    var dirs = [BIN_DIR];
    if (IS_WIN) {
      var la = process.env.LOCALAPPDATA || '';
      dirs.push(
        path.join(la, 'Microsoft', 'WinGet', 'Links'),
        path.join(HOME, 'scoop', 'shims'),
        'C:\\ProgramData\\chocolatey\\bin',
        'C:\\ffmpeg\\bin',
        path.join(HOME, '.deno', 'bin')
      );
    } else {
      dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin',
        path.join(HOME, 'bin'), path.join(HOME, '.local', 'bin'),
        path.join(HOME, '.deno', 'bin'), path.join(HOME, '.volta', 'bin'), '/usr/bin');
      // ~/.local/node-*/bin 、 ~/.nvm/versions/node/*/bin（版本号从新到旧）
      listDirs(path.join(HOME, '.local')).filter(function (d) {
        return /node-v?\d/.test(path.basename(d));
      }).sort().reverse().forEach(function (d) { dirs.push(path.join(d, 'bin')); });
      listDirs(path.join(HOME, '.nvm', 'versions', 'node')).sort().reverse()
        .forEach(function (d) { dirs.push(path.join(d, 'bin')); });
    }
    (process.env.PATH || '').split(path.delimiter).forEach(function (d) { if (d) dirs.push(d); });
    var seen = {};
    return dirs.filter(function (d) { if (seen[d]) return false; seen[d] = 1; return true; });
  }

  /** 找到可执行文件的绝对路径；custom 为用户在设置里指定的路径 */
  function findTool(name, custom) {
    if (custom && isFile(custom)) return custom;
    if (name === 'yt-dlp' && IS_MAC && isFile(YTDLP_MAC_EXE)) return YTDLP_MAC_EXE;
    var names = [name + EXE];
    if (name === 'yt-dlp') names.push(IS_WIN ? 'yt-dlp.exe' : 'yt-dlp_macos');
    var dirs = searchDirs();
    for (var i = 0; i < dirs.length; i++) {
      for (var j = 0; j < names.length; j++) {
        var p = path.join(dirs[i], names[j]);
        if (isFile(p)) return p;
      }
    }
    return null;
  }

  function childEnv() {
    var env = {};
    Object.keys(process.env).forEach(function (k) { env[k] = process.env[k]; });
    env.PATH = searchDirs().join(path.delimiter);
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
    if (!env.LANG) env.LANG = 'en_US.UTF-8';
    return env;
  }

  function runCapture(bin, args, timeoutMs) {
    return new Promise(function (resolve) {
      cp.execFile(bin, args, { env: childEnv(), timeout: timeoutMs || 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        function (err, stdout, stderr) {
          resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
  }

  /** 检测所有依赖，返回 { ytdlp, ytdlpVersion, ffmpeg, jsRuntime } */
  function detect(custom) {
    custom = custom || {};
    var out = {
      ytdlp: findTool('yt-dlp', custom.ytdlp),
      ffmpeg: findTool('ffmpeg', custom.ffmpeg),
      jsRuntime: null,
      ytdlpVersion: null
    };
    var deno = findTool('deno');
    if (deno) out.jsRuntime = { name: 'deno', path: deno };
    else {
      var node = findTool('node');
      if (node) out.jsRuntime = { name: 'node', path: node };
    }
    if (!out.ytdlp) return Promise.resolve(out);
    return runCapture(out.ytdlp, ['--version'], 60000).then(function (r) {
      out.ytdlpVersion = r.ok ? r.stdout.trim() : null;
      if (!r.ok) out.ytdlpError = (r.stderr || r.stdout).trim().slice(-300);
      return out;
    });
  }

  // ---------------------------------------------------------------- 组件安装

  function httpDownload(url, dest, onProgress, redirects) {
    redirects = redirects || 0;
    return new Promise(function (resolve, reject) {
      var r = https.get(url, { headers: { 'User-Agent': 'LinkDrop-Premiere-Panel' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects > 8) return reject(new Error('重定向次数过多'));
          var next = new URL(res.headers.location, url).toString();
          return resolve(httpDownload(next, dest, onProgress, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('下载失败，HTTP ' + res.statusCode));
        }
        var total = parseInt(res.headers['content-length'] || '0', 10);
        var got = 0;
        var tmp = dest + '.download';
        var file = fs.createWriteStream(tmp);
        res.on('data', function (chunk) {
          got += chunk.length;
          if (onProgress && total) onProgress(got / total);
        });
        res.pipe(file);
        file.on('finish', function () {
          file.close(function () {
            try { fs.renameSync(tmp, dest); resolve(dest); } catch (e) { reject(e); }
          });
        });
        file.on('error', reject);
        res.on('error', reject);
      });
      r.on('error', reject);
      r.setTimeout(60000, function () { r.destroy(new Error('网络超时')); });
    });
  }

  function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); }

  function unzip(zip, destDir) {
    return new Promise(function (resolve, reject) {
      var bin, args;
      if (IS_WIN) {
        bin = 'powershell.exe';
        args = ['-NoProfile', '-Command', 'Expand-Archive -Force -LiteralPath "' + zip + '" -DestinationPath "' + destDir + '"'];
      } else if (IS_MAC) {
        bin = '/usr/bin/ditto'; args = ['-x', '-k', zip, destDir];
      } else {
        bin = 'unzip'; args = ['-o', zip, '-d', destDir];
      }
      cp.execFile(bin, args, { windowsHide: true }, function (err) {
        try { fs.unlinkSync(zip); } catch (e) { /* ignore */ }
        if (err) reject(err); else resolve(destDir);
      });
    });
  }

  function rmrf(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  // macOS 用解压版（onedir）：单文件版每次运行都会解包到新临时目录并被系统重新扫描，启动要 30 秒以上
  var YTDLP_MAC_DIR = path.join(BIN_DIR, 'yt-dlp-dist');
  var YTDLP_MAC_EXE = path.join(YTDLP_MAC_DIR, 'yt-dlp_macos');

  /** 从 yt-dlp 官方 GitHub Release 安装 */
  function installYtDlp(onProgress) {
    mkdirp(BIN_DIR);
    var base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
    if (IS_MAC) {
      var zip = path.join(BIN_DIR, 'yt-dlp_macos.zip');
      var tmpDir = YTDLP_MAC_DIR + '.new';
      rmrf(tmpDir);
      return httpDownload(base + 'yt-dlp_macos.zip', zip, onProgress)
        .then(function () { return unzip(zip, tmpDir); })
        .then(function () {
          if (!isFile(path.join(tmpDir, 'yt-dlp_macos'))) throw new Error('压缩包结构不符合预期');
          rmrf(YTDLP_MAC_DIR);
          fs.renameSync(tmpDir, YTDLP_MAC_DIR);
          fs.chmodSync(YTDLP_MAC_EXE, 493);
          rmrf(path.join(BIN_DIR, 'yt-dlp')); // 清理旧的单文件版
          return YTDLP_MAC_EXE;
        });
    }
    var dest = path.join(BIN_DIR, 'yt-dlp' + EXE);
    return httpDownload(base + (IS_WIN ? 'yt-dlp.exe' : 'yt-dlp_linux'), dest, onProgress)
      .then(function () { if (!IS_WIN) fs.chmodSync(dest, 493); return dest; });
  }

  /** 安装 Deno（YouTube 解析需要一个 JS 运行时） */
  function installDeno(onProgress) {
    mkdirp(BIN_DIR);
    var arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    var target = IS_WIN ? 'x86_64-pc-windows-msvc' : (IS_MAC ? arch + '-apple-darwin' : arch + '-unknown-linux-gnu');
    var zip = path.join(BIN_DIR, 'deno.zip');
    return httpDownload('https://github.com/denoland/deno/releases/latest/download/deno-' + target + '.zip', zip, onProgress)
      .then(function () { return unzip(zip, BIN_DIR); })
      .then(function () {
        var dest = path.join(BIN_DIR, 'deno' + EXE);
        if (!IS_WIN) fs.chmodSync(dest, 493);
        return dest;
      });
  }

  /** 更新 yt-dlp。插件自己安装的 macOS 解压版直接重新下载最新版 */
  function updateYtDlp(bin, onProgress) {
    if (IS_MAC && bin === YTDLP_MAC_EXE) {
      return installYtDlp(onProgress).then(function () { return '已更新到最新版'; });
    }
    return runCapture(bin, ['-U'], 180000).then(function (r) {
      var text = (r.stdout + '\n' + r.stderr).trim();
      if (!r.ok && !/up to date|Updated yt-dlp/i.test(text)) throw new Error(text.slice(-300) || '更新失败');
      return text.split('\n').pop();
    });
  }

  // ---------------------------------------------------------------- 链接处理

  /** 从任意文本（分享文案、多行粘贴）中提取链接 */
  function extractUrls(text) {
    var re = /https?:\/\/[^\s<>"'，。！？、；）】》]+/gi;
    var found = String(text || '').match(re) || [];
    var seen = {};
    return found.map(function (u) { return u.replace(/[),.;!?]+$/, ''); })
      .filter(function (u) { if (seen[u]) return false; seen[u] = 1; return true; });
  }

  function siteOf(url) {
    var h = '';
    try { h = new URL(url).hostname.toLowerCase(); } catch (e) { return '网页'; }
    if (/youtube\.com|youtu\.be/.test(h)) return 'YouTube';
    if (/bilibili\.com|b23\.tv/.test(h)) return 'Bilibili';
    if (/douyin\.com/.test(h)) return '抖音';
    if (/tiktok\.com/.test(h)) return 'TikTok';
    if (/vimeo\.com/.test(h)) return 'Vimeo';
    if (/twitter\.com|x\.com/.test(h)) return 'X';
    if (/instagram\.com/.test(h)) return 'Instagram';
    if (/xiaohongshu\.com|xhslink\.com/.test(h)) return '小红书';
    if (/weibo\.(com|cn)/.test(h)) return '微博';
    if (/yueliu\./.test(h)) return '阅流';
    return h.replace(/^www\./, '');
  }

  // ---------------------------------------------------------------- yt-dlp 参数

  var QUALITY_SORT = {
    best: 'res,vcodec:h264,acodec:aac',
    '2160': 'res:2160,vcodec:h264,acodec:aac',
    '1080': 'res:1080,vcodec:h264,acodec:aac',
    '720': 'res:720,vcodec:h264,acodec:aac',
    '480': 'res:480,vcodec:h264,acodec:aac'
  };

  // ---------------------------------------------------------------- 代理例外
  // yt-dlp 会读取系统代理（macOS 网络设置 / Windows Internet 选项 / HTTP(S)_PROXY），
  // 但不认系统代理的「例外 / 绕过」列表。像新片场这类国内站点，用户在 Clash 等工具里设成直连、
  // 并加进了系统代理例外，yt-dlp 却仍然走代理，结果 SSL 握手被掐断
  // （UNEXPECTED_EOF_WHILE_READING）。这里自己读例外列表，命中就让 yt-dlp 直连。

  var bypassCache = null;

  function readBypassList() {
    if (bypassCache) return bypassCache;
    var list = [];
    (process.env.NO_PROXY || process.env.no_proxy || '').split(',').forEach(function (s) { list.push(s); });
    try {
      if (IS_MAC) {
        var out = String(cp.execFileSync('/usr/sbin/scutil', ['--proxy'], { timeout: 3000 }));
        var m = /ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/.exec(out);
        if (m) m[1].split('\n').forEach(function (l) { var x = /^\s*\d+\s*:\s*(.+?)\s*$/.exec(l); if (x) list.push(x[1]); });
      } else if (IS_WIN) {
        var reg = String(cp.execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyOverride'], { timeout: 3000, windowsHide: true }));
        var w = /ProxyOverride\s+REG_\w+\s+(.*)/.exec(reg);
        if (w) w[1].split(';').forEach(function (s) { list.push(s); });
      }
    } catch (e) { /* 没配置系统代理 */ }
    bypassCache = list.map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    return bypassCache;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch (e) { return ''; }
  }

  /** 该主机是否在系统代理例外 / NO_PROXY 里 */
  function proxyBypassed(host) {
    if (!host) return false;
    return readBypassList().some(function (p) {
      if (p === '*') return true;
      if (p === '<local>') return host.indexOf('.') < 0;
      if (p.indexOf('/') >= 0) return false; // CIDR 网段，只对 IP 有意义，忽略
      // *.example.com / .example.com / example.com 都按「本域及子域」处理
      p = p.replace(/^\*?\./, '').replace(/^\*/, '');
      if (!p) return false;
      if (p.indexOf('*') >= 0) {
        return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(host);
      }
      return host === p || host.slice(-(p.length + 1)) === '.' + p;
    });
  }

  /** 代理导致的连接失败（被掐断 / 隧道失败），可以改用直连重试 */
  function isProxyError(msg) {
    return /UNEXPECTED_EOF_WHILE_READING|EOF occurred in violation of protocol|ProxyError|Tunnel connection failed|Unable to connect to proxy|SSL_ERROR_SYSCALL|Connection closed abruptly|Remote end closed connection/i.test(msg || '');
  }

  // ---------------------------------------------------------------- 站点专用参数

  var SITE_ARGS = [
    {
      // 新片场的 WAF 会对「像浏览器」的请求（完整 Chrome UA）返回人机验证页，yt-dlp 就解析不到 next.js 数据。
      // 换一个非浏览器 UA 就会直接返回页面。视频 CDN（xpccdn.com）不带新片场 Referer 会返回 403
      host: /(^|\.)xinpianchang\.com$/,
      args: ['--user-agent', 'LinkDrop', '--referer', 'https://www.xinpianchang.com/']
    }
  ];

  /**
   * opts: { outDir, quality, cookiesBrowser, tools:{ffmpeg, jsRuntime}, playlist, direct }
   */
  function buildArgs(url, opts) {
    var tools = opts.tools || {};
    var a = [
      '--newline', '--no-colors', '--progress', '--no-mtime',
      '--progress-template', 'download:LDPROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(info.vcodec)s',
      '--print', 'video:LDMETA%(.{id,title,duration,thumbnail,uploader,extractor_key,width,height})j',
      '--print', 'after_move:LDFILE%(filepath)j',
      '-o', path.join(opts.outDir, opts.outName ? opts.outName.replace(/[\\/:*?"<>|%]/g, '_') + '.%(ext)s' : '%(title).80B [%(id)s].%(ext)s'),
      '--retries', '5', '--fragment-retries', '10',
      '--concurrent-fragments', '4'
    ];
    if (!opts.playlist) a.push('--no-playlist');
    if (tools.ffmpeg) a.push('--ffmpeg-location', tools.ffmpeg);
    if (tools.jsRuntime) a.push('--js-runtimes', tools.jsRuntime.name + ':' + tools.jsRuntime.path);
    if (opts.cookiesBrowser) a.push('--cookies-from-browser', opts.cookiesBrowser);
    var host = hostOf(url);
    if (opts.direct || proxyBypassed(host)) a.push('--proxy', '');
    SITE_ARGS.forEach(function (s) { if (s.host.test(host)) a.push.apply(a, s.args); });

    if (opts.quality === 'audio') {
      a.push('-f', 'ba[acodec^=mp4a]/ba/b');
      if (tools.ffmpeg) a.push('-x', '--audio-format', 'm4a');
    } else if (!tools.ffmpeg) {
      // 没有 ffmpeg 无法合并音视频，只能取自带音轨的单文件
      a.push('-f', 'b[ext=mp4]/b');
    } else {
      a.push('-S', QUALITY_SORT[opts.quality] || QUALITY_SORT['1080'], '--merge-output-format', 'mp4');
    }
    a.push('--', url);
    return a;
  }

  function parsePercent(s) {
    var m = /([\d.]+)%/.exec(s || '');
    return m ? Math.min(100, parseFloat(m[1])) : null;
  }

  function cleanErr(line) {
    return line.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, '').trim();
  }

  var BROWSER_NAMES = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', brave: 'Brave' };

  /**
   * 把 yt-dlp 的报错翻译成中文，并给出分类，面板据此提供一键修复：
   *   auth    需要登录状态（YouTube 机器人验证 / 年龄限制 / 会员）→ 用浏览器登录信息重试
   *   cookies 读取浏览器登录信息失败 → 换一个浏览器
   *   js      缺 JS 运行时 → 安装组件
   *   ffmpeg  缺 ffmpeg → 打开设置
   */
  function friendlyError(msg, cookiesBrowser) {
    var b = BROWSER_NAMES[cookiesBrowser] || cookiesBrowser;
    if (/Sign in to confirm|not a bot|confirm your age|age.?restricted|members.?only|login required|需要登录/i.test(msg)) {
      return {
        kind: 'auth',
        msg: cookiesBrowser
          ? '已使用 ' + b + ' 的登录信息，仍被拦截。请确认 ' + b + ' 已登录该网站，或换一个浏览器：'
          : '该网站需要登录状态才能下载，用已登录的浏览器一键重试：'
      };
    }
    if (/Operation not permitted/i.test(msg) && /safari|cookies/i.test(msg)) {
      return { kind: 'cookies', msg: 'Safari 的登录信息需要给 Premiere 开启「完全磁盘访问权限」，建议换一个浏览器：' };
    }
    if (/could not find .*cookies|cookies database|failed to decrypt|cannot decrypt|keyring|DPAPI|could not copy .*cookie/i.test(msg)) {
      return { kind: 'cookies', msg: '读取 ' + (b || '浏览器') + ' 登录信息失败，可换一个浏览器重试：' };
    }
    if (/No supported JavaScript runtime|js.?runtime|n challenge|nsig/i.test(msg)) {
      return { kind: 'js', msg: '缺少 JS 运行时（Deno/Node），YouTube 无法解析' };
    }
    if (/ffmpeg/i.test(msg) && /not found|not installed/i.test(msg)) return { kind: 'ffmpeg', msg: '缺少 ffmpeg，无法合并音视频' };
    if (isProxyError(msg)) {
      return { kind: null, msg: '网络连接被中断（已自动尝试直连仍失败）。如果开着代理 / VPN，请把该网站设为直连或暂时关闭代理后重试' };
    }
    if (/Unsupported URL/i.test(msg)) return { kind: null, msg: '不支持的链接：' + msg };
    if (/Private video/i.test(msg)) return { kind: null, msg: '私密视频，无法下载' };
    if (/HTTP Error 412|HTTP Error 403/i.test(msg)) {
      return { kind: 'auth', msg: '网站拒绝访问（' + msg.replace(/^.*(HTTP Error \d+).*$/, '$1') + '），可用已登录的浏览器重试：' };
    }
    return { kind: null, msg: msg };
  }

  /** 本机装过（有用户数据目录）的浏览器，按推荐顺序 */
  function installedBrowsers() {
    var la = process.env.LOCALAPPDATA || '', ad = process.env.APPDATA || '';
    var AS = path.join(HOME, 'Library', 'Application Support');
    var dirs = IS_WIN ? {
      chrome: path.join(la, 'Google', 'Chrome', 'User Data'),
      edge: path.join(la, 'Microsoft', 'Edge', 'User Data'),
      firefox: path.join(ad, 'Mozilla', 'Firefox', 'Profiles'),
      brave: path.join(la, 'BraveSoftware', 'Brave-Browser', 'User Data')
    } : {
      chrome: path.join(AS, 'Google', 'Chrome'),
      edge: path.join(AS, 'Microsoft Edge'),
      firefox: path.join(AS, 'Firefox', 'Profiles'),
      brave: path.join(AS, 'BraveSoftware', 'Brave-Browser'),
      safari: IS_MAC ? path.join(HOME, 'Library', 'Containers', 'com.apple.Safari') : ''
    };
    var MAC_APPS = { chrome: 'Google Chrome.app', edge: 'Microsoft Edge.app', firefox: 'Firefox.app', brave: 'Brave Browser.app' };
    function isDir(p) { try { return !!p && fs.statSync(p).isDirectory(); } catch (e) { return false; } }
    function appInstalled(id) {
      if (!IS_MAC || id === 'safari') return true;
      return isDir(path.join('/Applications', MAC_APPS[id])) || isDir(path.join(HOME, 'Applications', MAC_APPS[id]));
    }
    // 既要有用户数据目录（用过），macOS 上还要求 App 仍然存在（排除卸载后残留的目录）
    return Object.keys(dirs).filter(function (id) { return isDir(dirs[id]) && appInstalled(id); })
      .map(function (id) { return { id: id, name: BROWSER_NAMES[id] }; });
  }

  /**
   * 启动下载。handlers: onMeta(meta), onProgress({percent, speed, eta, part}), onDone(filepath), onError(msg)
   * 返回 { cancel() }
   */
  function download(ytdlp, url, opts, handlers) {
    handlers = handlers || {};
    try { mkdirp(opts.outDir); } catch (e) { setTimeout(function () { handlers.onError && handlers.onError('无法创建下载目录：' + e.message, 'dir'); }); return { cancel: function () {} }; }
    var cancelled = false;
    var child = null;
    var ctl = {
      args: null,
      cancel: function () {
        cancelled = true;
        if (!child) return;
        try {
          if (IS_WIN) cp.execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
          else child.kill('SIGTERM');
        } catch (e) { /* ignore */ }
      }
    };
    start(!!opts.direct);
    return ctl;

    function start(direct) {
      var runOpts = Object.assign({}, opts, { direct: direct });
      var args = buildArgs(url, runOpts);
      ctl.args = args;
      child = cp.spawn(ytdlp, args, { env: childEnv(), windowsHide: true });
      var files = [];
      var errors = [];
      var tail = [];
      var lastPart = null;
      var partIndex = 0;

      function onLine(line) {
        line = line.replace(/\r/g, '').trim();
        if (!line) return;
        if (line.indexOf('LDPROG|') === 0) {
          var p = line.split('|');
          var part = p[4] === 'none' ? 'audio' : 'video';
          if (part !== lastPart) { lastPart = part; partIndex++; }
          handlers.onProgress && handlers.onProgress({
            percent: parsePercent(p[1]), speed: (p[2] || '').trim(), eta: (p[3] || '').trim(),
            part: part, partIndex: partIndex
          });
        } else if (line.indexOf('LDMETA') === 0) {
          try { handlers.onMeta && handlers.onMeta(JSON.parse(line.slice(6))); } catch (e) { /* ignore */ }
        } else if (line.indexOf('LDFILE') === 0) {
          try { files.push(JSON.parse(line.slice(6))); } catch (e) { /* ignore */ }
        } else if (/^ERROR:/.test(line)) {
          errors.push(cleanErr(line));
        } else if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM3u8|FixupM4a)\]/.test(line)) {
          handlers.onStage && handlers.onStage(/ExtractAudio/.test(line) ? '提取音频…' : '合并音视频…');
        } else {
          tail.push(line);
          if (tail.length > 20) tail.shift();
        }
      }

      function pipe(stream) {
        var buf = '';
        stream.setEncoding('utf8');
        stream.on('data', function (d) {
          buf += d;
          var parts = buf.split('\n');
          buf = parts.pop();
          parts.forEach(onLine);
        });
        stream.on('end', function () { if (buf) onLine(buf); });
      }
      pipe(child.stdout);
      pipe(child.stderr);

      var finished = false;
      function finish(fn) { if (!finished) { finished = true; fn(); } }

      child.on('error', function (e) {
        finish(function () { handlers.onError && handlers.onError('无法启动 yt-dlp：' + e.message); });
      });
      child.on('close', function (code) {
        finish(function () {
          if (cancelled) return handlers.onError && handlers.onError('已取消', 'cancelled');
          var existing = files.filter(isFile);
          if (code === 0 && existing.length) return handlers.onDone && handlers.onDone(existing);
          var raw = errors.length ? errors[errors.length - 1]
            : (tail.length ? tail.slice(-3).join(' / ') : 'yt-dlp 退出码 ' + code);
          // 走代理时连接被掐断：改用直连自动重试一次（没开代理时等同于原样重试）
          if (!direct && isProxyError(raw)) {
            handlers.onStage && handlers.onStage('代理连接失败，改用直连重试…');
            return start(true);
          }
          var fe = friendlyError(raw, opts.cookiesBrowser);
          handlers.onError && handlers.onError(fe.msg, fe.kind, raw);
        });
      });
    }
  }

  // ---------------------------------------------------------------- 阅流（yueliu.smallrig.com）分享链接
  //
  // 阅流不在 yt-dlp 支持列表里。这里按阅流网页自己的调用方式读取分享里的文件列表，
  // 取每个视频的云端转码流（m3u8，免登录可看的最高清晰度），再交给 yt-dlp 下载合并成 mp4。
  // 原文件下载接口要求登录，未接入。

  var YL_API = 'https://api-yueliu.smallrig.com';
  var YL_AS = 'bxXSb6ewEJ3YDcNW';

  function md5(s) { return require('crypto').createHash('md5').update(String(s)).digest('hex'); }

  /** 返回分享码；不是阅流分享链接时返回 null */
  function yueliuCode(url) {
    var u;
    try { u = new URL(url); } catch (e) { return null; }
    if (!/(^|\.)yueliu\.smallrig\.com$/i.test(u.hostname)) return null;
    var m = /\/(?:shareAssetsPage|shareLandingPage|shareList|shareFile|share)\/(\d{6,})/.exec(u.hash + ' ' + u.pathname);
    return m ? m[1] : null;
  }

  function ylGet(apiPath, params, code) {
    var ts = Date.now();
    var tok = md5(YL_AS + ts);
    var q = new URLSearchParams(params);
    q.set('verify', md5(tok));
    return new Promise(function (resolve, reject) {
      var r = https.get(YL_API + apiPath + '?' + q.toString(), {
        headers: {
          appSerectToken: tok, timestamp: String(ts), 'X-PLATFORM': '1', 'app-canary': '-1',
          'X-PATH': '#/shareAssetsPage/' + code, Referer: 'https://yueliu.smallrig.com/'
        }
      }, function (res) {
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function (d) { body += d; });
        res.on('end', function () {
          var j;
          try { j = JSON.parse(body); } catch (e) { return reject(new Error('阅流返回了无法识别的数据（HTTP ' + res.statusCode + '）')); }
          if (j.code !== 1000) return reject(new Error('阅流：' + (j.msg || '错误码 ' + j.code)));
          resolve(j.data);
        });
      });
      r.on('error', function (e) { reject(new Error('无法连接阅流：' + e.message)); });
      r.setTimeout(20000, function () { r.destroy(new Error('连接阅流超时')); });
    });
  }

  /** 视频条目里清晰度最高的 m3u8 地址 */
  function ylBestStream(item) {
    var vids = (item.cloud_resolutions && item.cloud_resolutions.video) || [];
    var best = null;
    vids.forEach(function (v) {
      Object.keys(v).forEach(function (k) {
        var val = v[k];
        if (typeof val === 'string' && /^https?:\/\/.*\.m3u8/i.test(val)) {
          var h = Math.min(v.width || 0, v.height || 0) || 0; // 竖屏按短边算清晰度
          if (!best || h > best.short) best = { url: val, short: h, width: v.width, height: v.height };
        }
      });
    });
    return best;
  }

  /**
   * 列出分享里的全部文件（递归进入文件夹）。
   * 返回 { title, owner, files:[{ id, name, base, ext, type, stream, width, height, duration, thumb, size }] }
   */
  function yueliuList(url) {
    var code = yueliuCode(url);
    if (!code) return Promise.reject(new Error('无法识别的阅流链接'));
    var out = [];
    var info = {};
    function page(folderId, n) {
      var p = { code: code, page: n, page_size: 100 };
      if (folderId) p.folder_id = folderId;
      return ylGet('/share/v1/files', p, code).then(function (d) {
        var list = (d && d.list) || [];
        var chain = Promise.resolve();
        list.forEach(function (it) {
          if (it.type === 1) {
            var s = ylBestStream(it);
            var name = String(it.name || ('阅流文件 ' + it.id));
            out.push({
              id: it.id, name: name, base: name.replace(/\.[^.]+$/, ''), ext: (it.ext || '').toLowerCase(),
              type: it.file_type || '', stream: s,
              width: it.width || 0, height: it.height || 0,
              duration: it.time ? it.time / 1000 : 0,
              thumb: it.cover_img_thum || it.cover_img || '', size: it.size || 0
            });
          } else if (it.id) {
            chain = chain.then(function () { return page(it.id, 1); });
          }
        });
        return chain.then(function () {
          if (list.length && list.length >= 100) return page(folderId, n + 1);
        });
      });
    }
    return ylGet('/share/v1/detail', { code: code, name: 'shareAssetsPage' }, code)
      .then(function (d) {
        info.title = d.title || '';
        info.owner = (d.user_info && d.user_info.real_name) || '';
        if (d.is_password) throw new Error('这个阅流分享设置了访问密码，暂不支持');
        if (d.is_freeze) throw new Error('这个阅流分享已被冻结');
        return page(null, 1);
      })
      .then(function () {
        // 同名文件加编号，避免互相覆盖
        var seen = {};
        out.forEach(function (f) {
          var k = f.base.toLowerCase();
          if (seen[k]) f.base += ' (' + f.id + ')';
          seen[k] = 1;
        });
        info.code = code;
        info.files = out;
        return info;
      });
  }

  // ---------------------------------------------------------------- Premiere 兼容性 / 转码

  var OK_VIDEO = /^(h264|hevc|prores|dnxhd|mpeg2video|mjpeg)$/;
  var OK_AUDIO = /^(aac|mp3|ac3|eac3|alac|pcm_\w+)$/;

  /** 用 ffmpeg -i 读取编码信息（不依赖 ffprobe） */
  function probe(ffmpeg, file) {
    return runCapture(ffmpeg, ['-hide_banner', '-i', file], 30000).then(function (r) {
      var t = r.stderr;
      var v = /Stream #\d+:\d+[^\n]*?: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(t);
      var a = /Stream #\d+:\d+[^\n]*?: Audio: (\w+)/.exec(t);
      var d = /Duration: (\d+):(\d+):([\d.]+)/.exec(t);
      return {
        vcodec: v ? v[1] : null, width: v ? +v[2] : 0, height: v ? +v[3] : 0,
        acodec: a ? a[1] : null,
        duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0
      };
    });
  }

  function needsTranscode(info) {
    var badV = !!info.vcodec && !OK_VIDEO.test(info.vcodec);
    var badA = !!info.acodec && !OK_AUDIO.test(info.acodec);
    return { video: badV, audio: badA, any: badV || badA };
  }

  var _encoderCache = {};
  function hasEncoder(ffmpeg, name) {
    var key = ffmpeg + '|' + name;
    if (key in _encoderCache) return Promise.resolve(_encoderCache[key]);
    return runCapture(ffmpeg, ['-hide_banner', '-encoders'], 15000).then(function (r) {
      _encoderCache[key] = r.stdout.indexOf(name) !== -1;
      return _encoderCache[key];
    });
  }

  /**
   * 将不兼容的视频转为 H.264/AAC MP4，完成后替换原文件。
   * 返回 { promise, cancel }
   */
  function makePremiereFriendly(ffmpeg, file, info, onProgress) {
    var child = null;
    var cancelled = false;
    var need = needsTranscode(info);
    var promise = (IS_MAC && need.video ? hasEncoder(ffmpeg, 'h264_videotoolbox') : Promise.resolve(false))
      .then(function (hw) {
        if (cancelled) throw new Error('已取消');
        var dir = path.dirname(file);
        var base = path.basename(file, path.extname(file));
        var finalPath = path.join(dir, base + '.mp4');
        var tmp = path.join(dir, base + '.linkdrop-tmp.mp4');
        var args = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-i', file, '-map', '0:v:0?', '-map', '0:a:0?'];
        if (need.video) {
          var h = info.height || 1080;
          if (hw) {
            var br = h >= 2160 ? '45M' : h >= 1440 ? '24M' : h >= 1080 ? '14M' : '8M';
            args.push('-c:v', 'h264_videotoolbox', '-b:v', br, '-allow_sw', '1');
          } else {
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18');
          }
          args.push('-pix_fmt', 'yuv420p', '-tag:v', 'avc1');
        } else {
          args.push('-c:v', 'copy');
        }
        args.push('-c:a', need.audio ? 'aac' : 'copy');
        if (need.audio) args.push('-b:a', '192k');
        args.push('-movflags', '+faststart', tmp);

        return new Promise(function (resolve, reject) {
          child = cp.spawn(ffmpeg, args, { env: childEnv(), windowsHide: true });
          var errTail = '';
          var buf = '';
          child.stdout.setEncoding('utf8');
          child.stdout.on('data', function (d) {
            buf += d;
            var lines = buf.split('\n'); buf = lines.pop();
            lines.forEach(function (l) {
              var m = /^out_time_(?:us|ms)=(\d+)/.exec(l);
              if (m && info.duration && onProgress) onProgress(Math.min(100, (+m[1] / 1e6) / info.duration * 100));
            });
          });
          child.stderr.setEncoding('utf8');
          child.stderr.on('data', function (d) { errTail = (errTail + d).slice(-600); });
          child.on('error', reject);
          child.on('close', function (code) {
            if (cancelled) { try { fs.unlinkSync(tmp); } catch (e) { /* */ } return reject(new Error('已取消')); }
            if (code !== 0) { try { fs.unlinkSync(tmp); } catch (e) { /* */ } return reject(new Error('转码失败：' + errTail.trim().split('\n').pop())); }
            try {
              fs.unlinkSync(file);
              fs.renameSync(tmp, finalPath);
              resolve(finalPath);
            } catch (e) { reject(e); }
          });
        });
      });
    return {
      promise: promise,
      cancel: function () { cancelled = true; if (child) try { child.kill('SIGTERM'); } catch (e) { /* */ } }
    };
  }

  // ---------------------------------------------------------------- 其他

  function defaultDownloadDir() {
    return IS_WIN ? path.join(HOME, 'Videos', 'LinkDrop') : path.join(HOME, 'Movies', 'LinkDrop');
  }

  function reveal(file) {
    if (IS_MAC) cp.execFile('open', ['-R', file]);
    else if (IS_WIN) cp.execFile('explorer.exe', ['/select,', file]);
    else cp.execFile('xdg-open', [path.dirname(file)]);
  }

  function readClipboard() {
    try {
      if (IS_MAC) return cp.execFileSync('pbpaste', { encoding: 'utf8', env: childEnv() });
      if (IS_WIN) return cp.execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', windowsHide: true });
    } catch (e) { /* ignore */ }
    return '';
  }

  function writeClipboard(text) {
    try {
      if (IS_MAC) cp.execFileSync('pbcopy', { input: String(text), env: childEnv() });
      else if (IS_WIN) cp.execFileSync('clip', { input: String(text), windowsHide: true });
      return true;
    } catch (e) { return false; }
  }

  var api = {
    IS_WIN: IS_WIN, IS_MAC: IS_MAC, DATA_DIR: DATA_DIR, BIN_DIR: BIN_DIR,
    findTool: findTool, detect: detect,
    installYtDlp: installYtDlp, installDeno: installDeno, updateYtDlp: updateYtDlp,
    extractUrls: extractUrls, siteOf: siteOf, buildArgs: buildArgs, download: download,
    yueliuCode: yueliuCode, yueliuList: yueliuList,
    friendlyError: friendlyError, installedBrowsers: installedBrowsers, BROWSER_NAMES: BROWSER_NAMES,
    probe: probe, needsTranscode: needsTranscode, makePremiereFriendly: makePremiereFriendly,
    defaultDownloadDir: defaultDownloadDir, reveal: reveal, readClipboard: readClipboard, writeClipboard: writeClipboard,
    pathJoin: path.join, basename: path.basename, dirname: path.dirname, isFile: isFile
  };

  if (typeof window !== 'undefined') window.LinkDropDL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
