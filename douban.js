// ==UserScript==
// @name         豆瓣信息自动填充 - 综合增强版
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  适配 task.ubweb.best (Element UI) 和 pan.ubweb.best (原生HTML)
// @author       Combined & Gemini & Enhanced
// @match        https://task.ubweb.best/*
// @match        https://pan.ubweb.best/*
// @match        *://ubweb.*/*
// @match        *://*.ubweb.*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      movie.douban.com
// @connect      douban.com
// @connect      sec.douban.com
// @updateURL    https://raw.githubusercontent.com/kayboy69/ubweb/refs/heads/main/douban.js
// @downloadURL  https://raw.githubusercontent.com/kayboy69/ubweb/refs/heads/main/douban.js
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 常量配置 ====================
    const CONFIG = {
        DEBOUNCE_DELAY: 500,
        SELECT_RETRY_COUNT: 20,
        SELECT_RETRY_INTERVAL: 100,
        REQUEST_TIMEOUT: 10000,
        DEBUG: false,  // 开启调试
    };

    const SITE_TYPE = detectSiteType();

    // ==================== 工具函数 ====================
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const log = (...args) => {
        if (CONFIG.DEBUG) console.log('[豆瓣填充]', ...args);
    };

    const logError = (...args) => {
        console.error('[豆瓣填充]', ...args);
    };

    function detectSiteType() {
        const hostname = window.location.hostname;
        if (hostname.includes('pan.ubweb')) return 'pan';
        if (hostname.includes('task.ubweb')) return 'task';
        return 'unknown';
    }

    // ==================== 按钮注入逻辑 ====================
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(injectButtons, CONFIG.DEBOUNCE_DELAY);
    });

    const startObserver = () => {
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
            log('MutationObserver 已启动，站点类型:', SITE_TYPE);
        } else {
            setTimeout(startObserver, 100);
        }
    };

    function injectButtons() {
        try {
            if (SITE_TYPE === 'task') {
                injectTaskButtons();
            } else if (SITE_TYPE === 'pan') {
                injectPanButtons();
            }
        } catch (error) {
            logError('按钮注入失败:', error);
        }
    }

    // ==================== Task 站点 (Element UI) ====================
    function injectTaskButtons() {
        // 模块 1：根据 Label "豆瓣链接" 注入
        const labels = Array.from(document.querySelectorAll('.el-form-item__label'));
        labels.forEach(label => {
            if (label.textContent.trim().includes('豆瓣链接')) {
                const container = label.closest('.el-form-item');
                if (!container) return;

                const input = container.querySelector('input, textarea');
                const btnContainer = container.querySelector('.el-form-item__content > div');

                if (input && btnContainer && !btnContainer.querySelector('.fetch-douban-btn-task-1')) {
                    initTaskButton1(input, btnContainer);
                    log('Task 模块1按钮已注入');
                }
            }
        });

        // 模块 2：根据 Placeholder 注入
        const urlInputs = document.querySelectorAll('input[placeholder="请输入豆瓣链接"]');
        urlInputs.forEach(inputEl => {
            const container = inputEl.closest('.el-form-item__content')?.children[0];
            if (container && !container.querySelector('.fetch-douban-btn-task-2')) {
                createTaskBtn2(inputEl, container);
                log('Task 模块2按钮已注入');
            }
        });
    }

    function initTaskButton1(doubanInput, btnContainer) {
        const fetchBtn = document.createElement('button');
        fetchBtn.type = 'button';
        fetchBtn.className = 'el-button el-button--primary fetch-douban-btn-task-1';
        fetchBtn.style.marginRight = '10px';
        fetchBtn.innerHTML = '<span>自动填写</span>';
        btnContainer.insertBefore(fetchBtn, btnContainer.firstChild);

        fetchBtn.addEventListener('click', async () => {
            const url = doubanInput.value.trim();
            if (!url || !url.includes('douban.com/subject/')) {
                alert('请输入有效的豆瓣链接！');
                return;
            }

            fetchBtn.innerHTML = '<span>请求中...</span>';
            fetchBtn.disabled = true;

            try {
                const data = await fetchDoubanInfo(url);
                autoFillTask('中文名', data["中文名"]);
                autoFillTask('英文名', data["英文名"]);
                autoFillTask('年份', data["年份"]);
                autoFillTask('季', data["季"]);
                autoFillTask('语言字幕', data["语言字幕"]);
                autoFillTask('下载集数', data["下载集数"]);
                autoFillTask('总集数', data["总集数"]);
                log('Task 模块1填充完成');
            } catch (error) {
                logError('抓取失败:', error);
                alert("抓取失败: " + error);
            } finally {
                fetchBtn.innerHTML = '<span>自动填写</span>';
                fetchBtn.disabled = false;
            }
        });
    }

    function createTaskBtn2(inputEl, container) {
        const btn = document.createElement('button');
        btn.innerText = '脚本解析';
        btn.type = 'button';
        btn.className = 'fetch-douban-btn-task-2';
        btn.style.cssText = 'margin-left: 10px; padding: 8px 15px; background-color: #67c23a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; flex-shrink: 0;';
        container.appendChild(btn);

        btn.onclick = async function() {
            const url = inputEl.value.trim();
            if (!url || !url.includes('douban.com/subject/')) {
                alert('请输入有效的豆瓣链接！');
                return;
            }

            btn.innerText = '解析中...';
            btn.disabled = true;

            try {
                const data = await fetchDoubanInfo(url);
                const dialogScope = inputEl.closest('.el-overlay-dialog') || document;
                await fillFormTask(data, dialogScope);
                log('Task 模块2填充完成');
            } catch (error) {
                logError('抓取失败:', error);
                alert("抓取失败: " + error);
            } finally {
                btn.innerText = '脚本解析';
                btn.disabled = false;
            }
        };
    }

    function autoFillTask(label, value, scope = document) {
        if (!value) return;
        const labels = Array.from(scope.querySelectorAll('.el-form-item__label'));
        const targetLabel = labels.find(el => el.textContent.trim().includes(label));
        const input = targetLabel ? targetLabel.closest('.el-form-item').querySelector('input, textarea') : null;
        if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            log(`已填充 ${label}: ${value}`);
        }
    }

    async function fillFormTask(data, dialogScope) {
        const items = dialogScope.querySelectorAll('.el-form-item');
        for (const item of items) {
            const label = item.querySelector('.el-form-item__label')?.innerText.trim();
            if (!label) continue;

            const input = item.querySelector('input.el-input__inner, textarea');
            if (input && data[label] && label !== "类型") {
                input.value = data[label];
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                log(`已填充 ${label}: ${data[label]}`);
            }

            if (label === "类型") {
                await fillSelectTask(item, data);
            }
        }
    }

    async function fillSelectTask(itemContainer, data) {
        const selectWrapper = itemContainer.querySelector('.el-select__wrapper');
        if (!selectWrapper) return;

        const genres = data["豆瓣所有类型"] || [];
        const hasEpisodes = data["是否有集数"];
        let targetValue = genres.includes("动画") ? "动漫" :
                         genres.includes("纪录片") ? "纪录" :
                         genres.some(g => ["真人秀", "脱口秀"].includes(g)) ? "综艺" :
                         (hasEpisodes ? "电视剧" : "电影");

        selectWrapper.click();

        let found = false;
        for (let i = 0; i < CONFIG.SELECT_RETRY_COUNT; i++) {
            await sleep(CONFIG.SELECT_RETRY_INTERVAL);
            const options = document.querySelectorAll('.el-select-dropdown__item');
            for (let opt of options) {
                if (opt.innerText.trim() === targetValue) {
                    opt.click();
                    found = true;
                    log(`已选择类型: ${targetValue}`);
                    break;
                }
            }
            if (found) break;
        }

        setTimeout(() => { document.body.click(); }, 100);
        if (!found) logError(`未找到类型选项: ${targetValue}`);
    }

    // ==================== Pan 站点 (原生 HTML) ====================
    function injectPanButtons() {
        // 主表单 - 豆瓣链接输入框旁边
        const mainDoubanInput = document.querySelector('#doubanUrl');
        if (mainDoubanInput && !document.querySelector('.fetch-douban-btn-pan-main')) {
            const parentRow = mainDoubanInput.closest('.input-row');
            if (parentRow) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-secondary fetch-douban-btn-pan-main';
                btn.innerText = '自动填写';
                btn.style.marginLeft = '10px';
                parentRow.appendChild(btn);

                btn.addEventListener('click', async () => {
                    const url = mainDoubanInput.value.trim();
                    if (!url || !url.includes('douban.com/subject/')) {
                        alert('请输入有效的豆瓣链接！');
                        return;
                    }

                    btn.innerText = '请求中...';
                    btn.disabled = true;

                    try {
                        const data = await fetchDoubanInfo(url);
                        fillPanMainForm(data);
                        log('Pan 主表单填充完成');
                    } catch (error) {
                        logError('抓取失败:', error);
                        alert("抓取失败: " + error);
                    } finally {
                        btn.innerText = '自动填写';
                        btn.disabled = false;
                    }
                });

                log('Pan 主表单按钮已注入');
            }
        }

        // 豆瓣模态框 - 解析按钮增强
        const parseBtn = document.querySelector('#parseBtn');
        if (parseBtn && !parseBtn.classList.contains('enhanced')) {
            const originalOnclick = parseBtn.onclick;
            parseBtn.onclick = async function(e) {
                e.preventDefault();
                const url = document.querySelector('#douban_modal_url').value.trim();
                if (!url || !url.includes('douban.com/subject/')) {
                    alert('请输入有效的豆瓣链接！');
                    return;
                }

                parseBtn.innerText = '解析中...';
                parseBtn.disabled = true;

                try {
                    const data = await fetchDoubanInfo(url);
                    fillPanDoubanModal(data);
                    log('Pan 豆瓣模态框填充完成');
                } catch (error) {
                    logError('抓取失败:', error);
                    alert("抓取失败: " + error);
                } finally {
                    parseBtn.innerText = '解析';
                    parseBtn.disabled = false;
                }
            };
            parseBtn.classList.add('enhanced');
            log('Pan 豆瓣模态框按钮已增强');
        }
    }

    function fillPanMainForm(data) {
        // 主表单字段映射
        setValueById('chsName', data["中文名"]);
        setValueById('engName', data["英文名"]);
        setValueById('year', data["年份"]);
        setValueById('season', data["季"]);
        setValueById('maxEps', data["总集数"]);
        setValueById('epToDown', data["下载集数"]);
        setValueById('langAndSub', data["语言字幕"]);
    }

    function fillPanDoubanModal(data) {
        // 豆瓣模态框字段映射
        setValueById('douban_chsName', data["中文名"]);
        setValueById('douban_alias', data["又名"]);
        setValueById('douban_totalEpisodes', data["总集数"]);
        setValueById('douban_director', data["导演"]);
        setValueById('douban_mainActor', data["主演"]);
        setValueById('douban_region', data["地区"]);
        setValueById('douban_languageSubtitle', data["语言字幕"]);

        // 类型选择
        const genreSelect = document.querySelector('#douban_genre');
        if (genreSelect) {
            const genres = data["豆瓣所有类型"] || [];
            const hasEpisodes = data["是否有集数"];
            let targetValue = genres.includes("动画") ? "动漫" :
                             genres.includes("纪录片") ? "纪录" :
                             genres.some(g => ["真人秀", "脱口秀"].includes(g)) ? "综艺" :
                             (hasEpisodes ? "电视剧" : "电影");

            genreSelect.value = targetValue;
            genreSelect.dispatchEvent(new Event('change', { bubbles: true }));
            log(`已选择类型: ${targetValue}`);
        }
    }

    function setValueById(id, value) {
        if (!value) return;
        const element = document.querySelector(`#${id}`);
        if (element) {
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            log(`已填充 #${id}: ${value}`);
        }
    }

    // ==================== 核心抓取逻辑 ====================
    function fetchDoubanInfo(url) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => reject('请求超时'), CONFIG.REQUEST_TIMEOUT);

            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: {
                    "User-Agent": navigator.userAgent,
                    "Referer": "https://movie.douban.com/"
                },
                timeout: CONFIG.REQUEST_TIMEOUT,
                onload: function(response) {
                    clearTimeout(timeoutId);

                    if (response.status !== 200) {
                        return reject(`请求失败，状态码: ${response.status}`);
                    }

                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, "text/html");
                        const htmlStr = response.responseText;
                        const infoText = doc.querySelector('#info')?.innerText || "";

                        const fullTitle = doc.querySelector('h1 span[property="v:itemreviewed"]')?.innerText.trim() || "";
                        const year = doc.querySelector('h1 .year')?.innerText.replace(/\(|\)/g, '') || "";

                        let { chineseName, englishName, seasonTag } = parseTitleAndSeason(fullTitle);

                        if (englishName && (!/[a-zA-Z]/.test(englishName) || /[一-龥぀-ヿ가-힯]/.test(englishName))) {
                            englishName = "";
                        }

                        if (!englishName) {
                            englishName = findEnglishFromAKA(infoText);
                        }

                        const otherNames = findOtherNamesFromAKA(infoText);
                        const rawLang = htmlStr.match(/语言:<\/span>\s*([^<]+)/)?.[1]?.split('/')[0]?.trim()
                                     || infoText.match(/语言:\s*(.*)/)?.[1]?.split('/')[0]
                                     || "未知";
                        const epMatch = htmlStr.match(/集数:<\/span>\s*(\d+)/) || infoText.match(/集数:\s*(\d+)/);

                        const directors = Array.from(doc.querySelectorAll('a[rel="v:directedBy"]'))
                            .map(a => a.innerText.trim())
                            .join(' ');
                        const actors = Array.from(doc.querySelectorAll('a[rel="v:starring"]'))
                            .slice(0, 5)
                            .map(a => a.innerText.trim())
                            .join(' ');

                        const result = {
                            "中文名": chineseName,
                            "英文名": cleanEnglishName(englishName),
                            "年份": year,
                            "季": seasonTag,
                            "又名": otherNames,
                            "总集数": epMatch ? epMatch[1] : "1",
                            "下载集数": '0',
                            "导演": directors ? `导演: ${directors}` : "",
                            "主演": actors ? `主演: ${actors}` : "",
                            "语言字幕": formatLanguageTag(rawLang),
                            "地区": htmlStr.match(/制片国家\/地区:<\/span>\s*([^<]+)/)?.[1]?.trim() || "",
                            "豆瓣所有类型": Array.from(doc.querySelectorAll('span[property="v:genre"]'))
                                .map(s => s.innerText.trim()),
                            "是否有集数": htmlStr.includes("集数:") || infoText.includes("集数:")
                        };

                        log('解析结果:', result);
                        resolve(result);
                    } catch (error) {
                        clearTimeout(timeoutId);
                        reject(`解析失败: ${error.message}`);
                    }
                },
                onerror: (err) => {
                    clearTimeout(timeoutId);
                    reject("网络请求异常: " + (err.error || "未知"));
                },
                ontimeout: () => {
                    clearTimeout(timeoutId);
                    reject("网络请求超时");
                }
            });
        });
    }

    // ==================== 辅助解析函数 ====================
    function chineseToNum(str) {
        const map = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
        if (str.length === 1) return map[str] || str;
        if (str.startsWith('十')) {
            const remaining = str.slice(1);
            return remaining ? 10 + (map[remaining] || 0) : 10;
        }
        if (str.length === 3) {
            const tens = map[str[0]];
            const ones = map[str[2]];
            if (tens && str[1] === '十' && ones) {
                return tens * 10 + ones;
            }
        }
        return str;
    }

    function parseTitleAndSeason(fullTitle) {
        log('========== 开始解析标题 ==========');
        log('原始标题:', fullTitle);

        let chineseName = "";
        let englishName = "";
        let seasonTag = "S01";

        // 处理 "第X季" 标记
        const seasonMatch = fullTitle.match(/第([一二三四五六七八九十百\d]+)季/);
        if (seasonMatch) {
            const endPos = seasonMatch.index + seasonMatch[0].length;
            chineseName = fullTitle.substring(0, endPos).trim();
            englishName = fullTitle.substring(endPos).trim();
            const seasonNum = seasonMatch[1];
            const num = isNaN(seasonNum) ? chineseToNum(seasonNum) : parseInt(seasonNum);
            seasonTag = `S${String(num).padStart(2, '0')}`;
        } else {
            // 新思路：从后往前找"最后一段可能是原名"的部分
            let splitPos = -1;

            // 策略1: 找最后一个"空格 + 假名/韩文/大写英文"的位置
            // 这样可以跳过中间的副标题，直接定位原名开始

            // 1a. 找包含假名的最后一段，然后往前找到"中文名结束"的位置
            const parts = fullTitle.split(/\s+/);
            log('标题分段:', parts);
            let lastKanaPart = -1;
            let firstKanaPart = -1;
            for (let i = 0; i < parts.length; i++) {
                if (/[ぁ-んァ-ヴ]/.test(parts[i])) {
                    if (firstKanaPart === -1) firstKanaPart = i;
                    lastKanaPart = i;
                    log(`  段${i}含假名:`, parts[i]);
                }
            }

            // 检查是否有"重复英文名"的模式（如 "DARK MOON ... DARK MOON ..."）
            // 策略：提取开头的连续大写英文单词，检查后面是否有重复
            let repeatPosition = -1;
            if (firstKanaPart !== -1 && lastKanaPart !== firstKanaPart && firstKanaPart >= 2) {
                // 提取标题开头的连续纯大写英文单词
                const leadingWords = [];
                for (let i = 0; i < parts.length; i++) {
                    if (/^[A-Z]+$/.test(parts[i]) && parts[i].length > 1) {
                        leadingWords.push(parts[i]);
                    } else {
                        break;  // 遇到非纯大写英文就停止
                    }
                }

                log('标题开头的英文单词:', leadingWords);

                if (leadingWords.length >= 1) {
                    const pattern = leadingWords.join(' ');
                    // 在标题的后半部分查找相同的英文单词序列
                    for (let i = leadingWords.length; i < lastKanaPart; i++) {
                        const checkWords = [];
                        for (let j = i; j < Math.min(i + leadingWords.length, lastKanaPart); j++) {
                            if (/^[A-Z]+$/.test(parts[j]) && parts[j].length > 1) {
                                checkWords.push(parts[j]);
                            } else {
                                break;  // 必须是连续的
                            }
                        }
                        const checkPattern = checkWords.join(' ');
                        if (checkPattern && checkPattern === pattern && checkWords.length === leadingWords.length) {
                            log(`  在位置${i}检测到重复英文名:`, checkPattern);
                            repeatPosition = i;  // 记录重复位置
                            break;
                        }
                    }
                }
            }

            // 如果检测到重复英文名，在重复位置之前分割
            let targetKanaPart = repeatPosition !== -1 ? repeatPosition : lastKanaPart;

            if (targetKanaPart > 0) {
                log('目标含假名段:', targetKanaPart);
                // 从含假名的段往前找，跳过可能是日文汉字标题的段
                let actualSplitPart = targetKanaPart;

                // 往前检查：跳过日文标题段
                for (let i = targetKanaPart - 1; i >= 1; i--) {
                    const part = parts[i];
                    log(`  检查段${i}:`, part);

                    // 判断是否应该跳过这一段：
                    // 1. 匹配"X年X组/班"模式
                    if (/^[\d]+[年]?[A-Z]?[組班級類话話集]/.test(part) && part.length <= 10) {
                        actualSplitPart = i;
                        log(`    -> 匹配日文标题模式，跳过`);
                        continue;
                    }

                    // 2. 如果这段含有假名（说明是日文），继续跳过
                    if (/[ぁ-んァ-ヴ]/.test(part)) {
                        actualSplitPart = i;
                        log(`    -> 含假名，跳过`);
                        continue;
                    }

                    // 否则停止回溯
                    log(`    -> 不匹配，停止回溯`);
                    break;
                }

                // 计算分割点
                if (actualSplitPart > 0) {
                    splitPos = parts.slice(0, actualSplitPart).join(' ').length;
                    log('最终分割点:', splitPos, '段索引:', actualSplitPart);
                }
            } else {
                log('未找到含假名的段');
            }

            // 1b. 如果没找到假名，找第一个"空格 + 韩文"（不是最后一个！）
            if (splitPos === -1) {
                const allKoreanMatches = [...fullTitle.matchAll(/\s+([가-힣])/g)];
                log('韩文匹配数量:', allKoreanMatches.length);
                if (allKoreanMatches.length > 0) {
                    allKoreanMatches.forEach((m, i) => log(`  韩文匹配${i}:`, m.index, m[0]));
                    splitPos = allKoreanMatches[0].index;  // 使用第一个，不是最后一个
                    log('韩文分割点:', splitPos);
                }
            }

            // 1c. 如果没找到，找最后一个"空格 + 连续大写英文单词"
            if (splitPos === -1) {
                const allEnglishMatches = [...fullTitle.matchAll(/\s+([A-Z][a-z]+\s+[A-Z])/g)];
                if (allEnglishMatches.length > 0) {
                    splitPos = allEnglishMatches[allEnglishMatches.length - 1].index;
                }
            }

            // 1d. 如果还没找到，找最后一个"空格 + 单个大写字母开头的较长英文单词"
            if (splitPos === -1) {
                const allSingleEnglishMatches = [...fullTitle.matchAll(/\s+([A-Z][a-z]{3,})/g)];
                if (allSingleEnglishMatches.length > 0) {
                    splitPos = allSingleEnglishMatches[allSingleEnglishMatches.length - 1].index;
                }
            }

            // 策略2: 保守的逐词检查（兜底）
            if (splitPos === -1) {
                const parts = fullTitle.split(' ');
                if (parts.length > 1) {
                    let currentLen = parts[0].length;
                    for (let i = 1; i < parts.length; i++) {
                        // 跳过明显是中文名一部分的标记
                        if (/^[～~\-·]/.test(parts[i]) || /^\d+[dD]$/.test(parts[i])) {
                            currentLen += 1 + parts[i].length;
                            continue;
                        }
                        // 如果这个 part 主要是英文字母（且不是单个字母）
                        if (parts[i].length > 1 && /^[a-zA-Z]/.test(parts[i]) && /[a-zA-Z]{2,}/.test(parts[i])) {
                            splitPos = currentLen;
                            break;
                        }
                        currentLen += 1 + parts[i].length;
                    }
                }
            }

            // 执行分割
            if (splitPos !== -1 && splitPos > 0) {
                chineseName = fullTitle.substring(0, splitPos).trim();
                englishName = fullTitle.substring(splitPos).trim();
            } else {
                chineseName = fullTitle;
            }
        }

        // 清理中文名：移除假名和部分特殊符号，而不是只保留特定字符
        // 这样可以保留各种引号和标点
        chineseName = chineseName.replace(/[ぁ-んァ-ヴ]/g, '').trim();

        // 清理英文名
        if (englishName) {
            englishName = englishName
                .replace(/Season\s*\d+/i, '')
                .replace(/S\d+/i, '')
                .replace(/\(\d{4}\)/, '')
                .trim();
        }

        return { chineseName, englishName, seasonTag };
    }

    function findEnglishFromAKA(infoText) {
        const akaMatch = infoText.match(/又名:\s*(.*)/);
        if (!akaMatch) return "";

        const names = akaMatch[1].split('/');
        for (let name of names) {
            name = name.trim();
            if (/^[a-zA-Z0-9\s!?.\-:']+$/.test(name) && /[a-zA-Z]/.test(name)) {
                return name
                    .replace(/Season\s*\d+/i, '')
                    .replace(/S\d+/i, '')
                    .trim();
            }
        }
        return "";
    }

    function findOtherNamesFromAKA(infoText) {
        const akaMatch = infoText.match(/又名:\s*(.*)/);
        if (!akaMatch) return "";

        return akaMatch[1]
            .split('/')
            .map(n => n.replace(/\s+/g, ''))
            .filter(n => /[^\x00-\xff]/.test(n))
            .join('/');
    }

    function cleanEnglishName(name) {
        if (!name || name === "N/A") return "";
        return name.replace(/\s+/g, ' ').trim();
    }

    function formatLanguageTag(rawLang) {
        if (!rawLang) return "";
        const lang = rawLang.trim();
        if (lang === "汉语普通话" || lang === "普通话") return "[国语/中字]";
        if (lang === "粤语") return "[粤语/简繁中字]";
        return `[${lang}/多语字幕]`;
    }

    // ==================== 初始化 ====================
    log('脚本已加载，站点类型:', SITE_TYPE, '域名:', window.location.hostname);
    startObserver();
    setTimeout(injectButtons, 1000);
})();
