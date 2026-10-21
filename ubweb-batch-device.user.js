// ==UserScript==
// @name         UBWEB 任务广场 - 批量设置设备ID
// @namespace    ubweb-batch-device
// @version      2.2.0
// @description  点击表格行选择栏目，通过接口批量设置设备ID（仅限当前登录账号认领的任务）
// @match        https://task.ubweb.best/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  if (window.__ubBatchDeviceInjected) return;
  window.__ubBatchDeviceInjected = true;

  let currentUser = '';
  const PUT_KEYS = [
    'id', 'webSite', 'url', 'chsName', 'engName', 'year', 'season', 'quality',
    'maxEps', 'epDownloaded', 'epToDown', 'langAndSub', 'doubanUrl', 'subTitleString',
    'torrentName', 'torrentId', 'priority', 'isUpdating', 'creatorName', 'executorName',
    'executorDevice', 'savePath', 'nasMountPath', 'isEnd', 'day', 'hour', 'remark', 'addedTime'
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  let devices = [];
  let account = null;
  let selected = new Set();
  let running = false;
  let stopFlag = false;
  let logLines = [];
  let flashTimer = null;

  let box, deviceSelect, refreshBtn, selectAllBtn, submitBtn, metaEl, labelEl;

  function getToken() {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('未登录或登录已过期，请重新登录');
    return token;
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = Object.assign(
      { Authorization: 'Bearer ' + getToken(), Accept: 'application/json' },
      opts.headers || {}
    );
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    if (res.status === 401) throw new Error('登录已过期，请刷新页面重新登录');
    if (!res.ok || (data && data.error)) {
      throw new Error((data && (data.message || data.error)) || 'HTTP ' + res.status);
    }
    return data;
  }

  async function loadAccount() {
    account = await api('/api/user/info');
    const name = norm(account && account.user_name);
    const uid = norm(account && account.uid);
    const next = name || uid;
    if (!next) throw new Error('无法识别当前登录账号');
    if (currentUser && next !== currentUser) selected.clear();
    currentUser = next;
    if (labelEl) {
      labelEl.title = '点击表格行选择栏目（仅限 ' + currentUser + ' 认领）';
    }
  }

  async function loadDevices() {
    const map = await api('/api/task/user-devices');
    const uid = norm(account && account.uid);
    const mine = map && (map[currentUser] || (uid ? map[uid] : null));
    if (!mine) throw new Error('未读取到 ' + currentUser + ' 的设备');
    devices = Object.keys(mine).map((id) => {
      const name = norm(mine[id] && mine[id].device_name) || '设备';
      return { id, label: '(' + name + ')' + id };
    });
    devices.push({ id: '1', label: '暂不下载' });

    const previous = deviceSelect.value;
    deviceSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择设备';
    deviceSelect.appendChild(placeholder);
    devices.forEach((d) => {
      const option = document.createElement('option');
      option.value = d.id;
      option.textContent = d.label;
      deviceSelect.appendChild(option);
    });
    if (devices.some((d) => d.id === previous)) deviceSelect.value = previous;
    deviceSelect.title = (deviceSelect.selectedOptions[0] || {}).textContent || '选择设备';
  }

  function tableRows() {
    return Array.from(document.querySelectorAll('main .el-table__body .el-table__row'));
  }

  function rowOwner(row) {
    return norm(row.cells[9] && row.cells[9].innerText);
  }

  function rowEligible(row) {
    return !!currentUser && rowOwner(row) === currentUser;
  }

  function rowBase(row) {
    const c = row.cells;
    return [0, 1, 2, 3, 5].map((i) => norm(c[i] && c[i].innerText)).join(' | ');
  }

  function rowName(row) {
    const c = row.cells;
    return [0, 1, 2, 3].map((i) => norm(c[i] && c[i].innerText)).filter(Boolean).join(' · ');
  }

  function taskBase(task) {
    return [task.webSite, task.chsName, task.season, task.quality, task.torrentId].map(norm).join(' | ');
  }

  function decoratedRows() {
    const seen = new Map();
    return tableRows().map((row) => {
      const base = rowBase(row);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { row, base, key: base + ' #' + n };
    });
  }

  function isEditEnabled(row) {
    return Array.from(row.querySelectorAll('button')).some(
      (b) => norm(b.textContent) === '编辑' && !b.disabled && !b.classList.contains('is-disabled')
    );
  }

  function currentPageInfo() {
    const pagination = document.querySelector('.el-pagination');
    const pageInput = pagination && pagination.querySelector('.el-input__inner');
    const page = parseInt(pageInput && pageInput.value, 10) || 1;
    const sizeSelect = pagination && pagination.querySelector('.el-select');
    const m = norm(sizeSelect && sizeSelect.textContent).match(/(\d+)\s*\/\s*page/i);
    const pageSize = m ? parseInt(m[1], 10) : 25;
    return { page, pageSize };
  }

  function latestTasksUrl(page, pageSize) {
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.indexOf('/api/tasks?') !== -1 && n.indexOf('_ubt=') === -1);
    const parsed = [];
    urls.forEach((u) => {
      try {
        parsed.push(new URL(u));
      } catch (e) {}
    });
    for (let i = parsed.length - 1; i >= 0; i--) {
      const u = parsed[i];
      if (u.searchParams.get('page') === String(page) && u.searchParams.get('pageSize') === String(pageSize)) {
        return u;
      }
    }
    return parsed.length ? parsed[parsed.length - 1] : null;
  }

  function filterSelectText(label) {
    const item = Array.from(document.querySelectorAll('.search-form .el-form-item')).find(
      (fi) => norm(fi.querySelector('.el-form-item__label') && fi.querySelector('.el-form-item__label').textContent) === label
    );
    return item ? norm(item.querySelector('.el-select') && item.querySelector('.el-select').textContent) : '';
  }

  function searchKeyword() {
    const item = Array.from(document.querySelectorAll('.search-form .el-form-item')).find(
      (fi) => norm(fi.querySelector('.el-form-item__label') && fi.querySelector('.el-form-item__label').textContent) === '搜索'
    );
    const input = item && item.querySelector('input');
    return input ? norm(input.value) : '';
  }

  function buildFallbackTasksUrl(page, pageSize) {
    const user = filterSelectText('用户');
    const web = filterSelectText('网站');
    const dl = filterSelectText('正在下载');
    const done = filterSelectText('是否下完');
    let downloadStatus = '';
    if (!/^在下/.test(dl)) {
      const m = dl.match(/\([^)]*\)([0-9a-f-]{36})/i);
      if (!m) throw new Error('无法识别「正在下载」筛选，请刷新页面后重试');
      downloadStatus = m[1];
    }
    let completionStatus = '';
    if (done === '未下完') completionStatus = '0';
    else if (done === '已下完') completionStatus = '1';
    else if (done !== '全部') throw new Error('无法识别「是否下完」筛选，请刷新页面后重试');
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      userName: user === 'All Users' ? '' : user,
      webName: web === 'All Web' ? '' : web,
      downloadStatus,
      completionStatus,
      keyword: searchKeyword()
    });
    return new URL('/api/tasks?' + qs.toString(), location.origin);
  }

  async function fetchCurrentTasks() {
    const info = currentPageInfo();
    const url = latestTasksUrl(info.page, info.pageSize) || buildFallbackTasksUrl(info.page, info.pageSize);
    url.searchParams.set('_ubt', String(Date.now()));
    const data = await api(url.pathname + url.search);
    const items = (data && data.items) || [];
    const rows = tableRows();
    if (!rows.length) throw new Error('当前页没有任务行');
    if (items.length !== rows.length) {
      throw new Error('接口返回 ' + items.length + ' 条，与表格 ' + rows.length + ' 行不一致，请刷新页面后重试');
    }
    return items;
  }

  function buildPayload(task, deviceId) {
    const payload = {};
    PUT_KEYS.forEach((k) => {
      payload[k] = task[k];
    });
    payload.executorDevice = deviceId;
    return payload;
  }

  function setMeta(text, kind) {
    if (!metaEl) return;
    const cls = 'ubdp-meta' + (kind ? ' ubdp-' + kind : '');
    if (metaEl.textContent !== text) metaEl.textContent = text;
    if (metaEl.className !== cls) metaEl.className = cls;
    metaEl.title = logLines.join('\n');
  }

  function flashMeta(text, kind) {
    if (flashTimer) clearTimeout(flashTimer);
    setMeta(text, kind);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      if (!running) syncHighlights();
    }, 2500);
  }

  function clearFlash() {
    if (flashTimer) {
      clearTimeout(flashTimer);
      flashTimer = null;
    }
  }

  function logPush(text, kind) {
    logLines.push(text);
    if (kind === 'err') console.warn('[UBWEB 批量设备]', text);
    if (logLines.length > 100) logLines.shift();
  }

  function updateSelectAllLabel(decorated) {
    const eligible = decorated.filter((d) => rowEligible(d.row));
    const all = eligible.length > 0 && eligible.every((d) => selected.has(d.key));
    const span = selectAllBtn && selectAllBtn.querySelector('span');
    const label = all ? '取消全选' : '全选本页';
    if (span && span.textContent !== label) span.textContent = label;
    selectAllBtn.disabled = eligible.length === 0;
  }

  function syncHighlights() {
    const decorated = decoratedRows();
    const keys = new Set(decorated.map((d) => d.key));
    if (!running) {
      Array.from(selected).forEach((key) => {
        if (!keys.has(key)) selected.delete(key);
      });
    }
    paintSelection(decorated);
    if (!running && !flashTimer) setMeta('已选 ' + selected.size + ' 行');
  }

  function toggleRow(row) {
    if (!rowEligible(row)) {
      flashMeta(
        currentUser ? '仅可操作 ' + currentUser + ' 认领的栏目' : '正在识别当前账号，请稍候',
        'error'
      );
      return;
    }
    const d = decoratedRows().find((x) => x.row === row);
    if (!d) return;
    if (selected.has(d.key)) selected.delete(d.key);
    else selected.add(d.key);
    clearFlash();
    syncHighlights();
  }

  function buildInline() {
    if (document.getElementById('ub-batch-inline')) return true;
    const bar = document.querySelector('.action-bar');
    if (!bar) return false;

    const style = document.createElement('style');
    style.textContent = `
      #ub-batch-inline{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;flex:0 1 auto}
      #ub-batch-inline .ubdp-sep{width:1px;height:18px;background:#e4e7ed;margin:0 2px}
      #ub-batch-inline .ubdp-label{font-size:13px;color:#909399;white-space:nowrap}
      #ub-batch-inline select{width:245px;max-width:40vw;height:32px;border:1px solid #dcdfe6;border-radius:4px;padding:0 28px 0 11px;font-size:13px;color:#606266;background-color:#fff;appearance:none;outline:none;cursor:pointer;background-image:url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'%3E%3Cpath fill='%23a8abb2' d='M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728 30.592 30.592 0 0 0-42.752 0z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;background-size:12px;transition:border-color .2s}
      #ub-batch-inline select:hover{border-color:#c0c4cc}
      #ub-batch-inline select:focus{border-color:#409eff}
      #ub-batch-inline .el-button + .el-button{margin-left:0}
      #ub-batch-inline .ubdp-icon{width:24px;height:24px;border:0;border-radius:4px;background:transparent;color:#909399;font-size:15px;line-height:24px;padding:0;cursor:pointer}
      #ub-batch-inline .ubdp-icon:hover{color:#409eff;background:#ecf5ff}
      #ub-batch-inline .ubdp-icon:disabled{color:#c0c4cc;background:transparent;cursor:not-allowed}
      #ub-batch-inline .ubdp-meta{font-size:12px;color:#909399;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;min-width:60px}
      #ub-batch-inline .ubdp-meta.ubdp-error{color:#f56c6c}
      #ub-batch-inline .ubdp-meta.ubdp-ok{color:#67c23a}
      main .el-table__body .el-table__row.ubdp-row-selected td{background-color:#ecf5ff !important}
      main .el-table__body .el-table__row.ubdp-row-selected td.el-table-fixed-column--left:first-child{box-shadow:inset 3px 0 0 #409eff}
    `;
    document.head.appendChild(style);

    box = document.createElement('div');
    box.id = 'ub-batch-inline';
    box.innerHTML = `
      <span class="ubdp-sep"></span>
      <span class="ubdp-label" title="点击表格行选择栏目（仅限当前登录账号认领）">批量设备ID</span>
      <select id="ubdp-device" title="选择设备"><option value="">读取设备…</option></select>
      <button id="ubdp-refresh" class="ubdp-icon" type="button" title="刷新设备列表">↻</button>
      <button id="ubdp-select-all" class="el-button" type="button" title="全选当前账号认领的行"><span>全选本页</span></button>
      <button id="ubdp-submit" class="el-button el-button--primary" type="button"><span>批量设置</span></button>
      <span class="ubdp-meta" id="ubdp-meta">已选 0 行</span>
    `;
    bar.appendChild(box);
    bar.style.flexWrap = 'wrap';
    bar.style.rowGap = '8px';
    bar.style.height = 'auto';
    bar.style.minHeight = '32px';

    deviceSelect = box.querySelector('#ubdp-device');
    refreshBtn = box.querySelector('#ubdp-refresh');
    selectAllBtn = box.querySelector('#ubdp-select-all');
    submitBtn = box.querySelector('#ubdp-submit');
    metaEl = box.querySelector('#ubdp-meta');
    labelEl = box.querySelector('.ubdp-label');

    deviceSelect.addEventListener('change', () => {
      const opt = deviceSelect.selectedOptions[0];
      deviceSelect.title = opt ? opt.textContent : '选择设备';
      clearFlash();
      if (!running) setMeta('已选 ' + selected.size + ' 行');
    });

    refreshBtn.addEventListener('click', () => {
      refreshDevices().catch((err) => setMeta(err.message, 'error'));
    });

    selectAllBtn.addEventListener('click', () => {
      const decorated = decoratedRows();
      const eligible = decorated.filter((d) => rowEligible(d.row));
      const all = eligible.length > 0 && eligible.every((d) => selected.has(d.key));
      eligible.forEach((d) => {
        if (all) selected.delete(d.key);
        else selected.add(d.key);
      });
      clearFlash();
      syncHighlights();
    });

    submitBtn.addEventListener('click', () => {
      if (running) {
        stopFlag = true;
        submitBtn.disabled = true;
        submitBtn.querySelector('span').textContent = '停止中…';
        setMeta('正在停止，等待当前请求完成…');
        return;
      }
      const deviceId = deviceSelect.value;
      if (!deviceId) return flashMeta('请先选择设备', 'error');
      if (!selected.size) return flashMeta('请先点击表格行选择栏目', 'error');
      const order = decoratedRows().map((d) => d.key);
      const keys = Array.from(selected).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      runBatch(keys, deviceId);
    });

    document.addEventListener(
      'click',
      (e) => {
        if (running) return;
        const target = e.target;
        if (!(target instanceof Element)) return;
        const row = target.closest('main .el-table__body .el-table__row');
        if (!row) return;
        if (target.closest('button, a, input, select, textarea, .el-checkbox, .el-dropdown, .el-tooltip__trigger')) return;
        const dlg = Array.from(document.querySelectorAll('.el-dialog')).some(
          (d) => d.getClientRects().length > 0
        );
        if (dlg) return;
        toggleRow(row);
      },
      false
    );

    let syncScheduled = false;
    new MutationObserver(() => {
      if (syncScheduled || !document.getElementById('ub-batch-inline')) return;
      syncScheduled = true;
      requestAnimationFrame(() => {
        syncScheduled = false;
        if (!running) syncHighlights();
      });
    }).observe(document.body, { childList: true, subtree: true });

    return true;
  }

  async function refreshDevices() {
    if (running) return;
    clearFlash();
    setMeta('读取设备中…');
    await loadAccount();
    await loadDevices();
    submitBtn.disabled = false;
    if (!flashTimer) setMeta('已选 ' + selected.size + ' 行');
  }

  function buildJobs(keys, items) {
    const decorated = decoratedRows();
    const positions = new Map();
    decorated.forEach((d, i) => positions.set(d.key, i));
    return keys.map((key) => {
      const pos = positions.get(key);
      if (pos == null) return { key, error: '当前页找不到该行' };
      const d = decorated[pos];
      const row = d.row;
      const name = rowName(row);
      if (!rowEligible(row)) return { key, name, error: '认领人不是当前账号' };
      let task = items[pos];
      if (!task || taskBase(task) !== rowBase(row)) {
        const hits = items.filter((it) => taskBase(it) === rowBase(row));
        if (hits.length === 1) task = hits[0];
        else if (hits.length === 0) return { key, name, error: '接口中找不到对应任务' };
        else return { key, name, error: '匹配到 ' + hits.length + ' 个相同任务，已跳过' };
      }
      if (!currentUser || norm(task.executorName) !== currentUser) {
        return { key, name, error: '任务认领人不是当前账号，已跳过' };
      }
      if (!isEditEnabled(row)) return { key, name, error: '编辑按钮不可用，已跳过' };
      return { key, name, task };
    });
  }

  async function runBatch(keys, deviceId) {
    running = true;
    stopFlag = false;
    logLines = [];
    clearFlash();
    submitBtn.disabled = false;
    submitBtn.querySelector('span').textContent = '停止';
    refreshBtn.disabled = true;
    selectAllBtn.disabled = true;
    deviceSelect.disabled = true;

    let ok = 0;
    let fail = 0;
    try {
      setMeta('读取任务中…');
      const items = await fetchCurrentTasks();
      const jobs = buildJobs(keys, items);
      const submittable = jobs.filter((j) => !j.error);
      logPush('开始：' + submittable.length + ' 行 → ' + deviceId);

      for (let i = 0; i < jobs.length; i++) {
        if (stopFlag) {
          logPush('已手动停止', 'err');
          break;
        }
        const job = jobs[i];
        if (job.error) {
          fail++;
          logPush('✗ ' + (job.name || job.key) + '：' + job.error, 'err');
          continue;
        }
        setMeta('提交中 ' + (i + 1) + '/' + jobs.length + ' · 成功 ' + ok);
        try {
          const data = await api('/api/tasks/' + job.task.id, {
            method: 'PUT',
            body: JSON.stringify(buildPayload(job.task, deviceId))
          });
          if (data && data.message && !/成功/.test(data.message)) {
            throw new Error(data.message);
          }
          job.task.executorDevice = deviceId;
          ok++;
          logPush('✓ ' + job.name + '（id ' + job.task.id + '）');
        } catch (err) {
          fail++;
          logPush('✗ ' + job.name + '（id ' + job.task.id + '）：' + err.message, 'err');
          if (/登录已过期|Unauthorized/.test(err.message)) break;
        }
        await sleep(120);
      }
    } catch (err) {
      fail++;
      logPush('✗ ' + err.message, 'err');
    } finally {
      running = false;
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = '批量设置';
      refreshBtn.disabled = false;
      selectAllBtn.disabled = false;
      deviceSelect.disabled = false;
    }

    if (ok) selected.clear();
    if (fail) {
      flashMeta('成功 ' + ok + ' · 失败 ' + fail + '（悬停查看）', 'error');
    } else if (ok) {
      flashMeta('成功 ' + ok + ' 行，正在刷新表格…', 'ok');
    } else {
      setMeta(stopFlag ? '已停止' : '没有可提交的栏目');
    }
    syncHighlightsQuiet();
    if (ok) {
      setTimeout(() => {
        if (running || selected.size) return;
        clearFlash();
        refreshTable();
      }, fail ? 3000 : 700);
    }
  }

  function refreshTable() {
    const btn = Array.from(document.querySelectorAll('.search-form button')).find(
      (b) => norm(b.textContent) === '搜索'
    );
    if (btn) btn.click();
    else location.reload();
  }

  function paintSelection(decorated) {
    decorated.forEach((d) => {
      const on = selected.has(d.key);
      if (d.row.classList.contains('ubdp-row-selected') !== on) {
        d.row.classList.toggle('ubdp-row-selected', on);
      }
    });
    updateSelectAllLabel(decorated);
  }

  function syncHighlightsQuiet() {
    paintSelection(decoratedRows());
  }

  function start() {
    if (!document.querySelector('.search-form') || !document.querySelector('.action-bar')) return false;
    if (!buildInline()) return false;
    refreshDevices().catch((err) => {
      submitBtn.disabled = true;
      setMeta(err.message, 'error');
    });
    return true;
  }

  const timer = setInterval(() => {
    if (start()) clearInterval(timer);
  }, 500);
})();
