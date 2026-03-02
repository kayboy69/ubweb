// ==UserScript==
// @name         豆瓣信息自动填充 - 综合增强版
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  优化性能、复用代码、增强健壮性与异常处理
// @author       Combined & Gemini
// @match        *://ubweb.*/*
// @match        *://*.ubweb.*/*
// @match        *://*/*ubweb*
// @include      *ubweb*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      movie.douban.com
// @connect      douban.com
// @connect      sec.douban.com
// ==/UserScript==

(function() {
    'use strict';

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // --- 1. 性能优化：使用 MutationObserver 替代 setInterval ---
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(injectButtons, 500); // 防抖，避免频繁执行
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // --- 2. 按钮注入逻辑 ---
    function injectButtons() {
        // 模块 1：根据 Label "豆瓣链接" 注入
        const labels = Array.from(document.querySelectorAll('.el-form-item__label'));
        labels.forEach(label => {
            if (label.textContent.trim().includes('豆瓣链接')) {
                const container = label.closest('.el-form-item');
                if (!container) return;
                const input = container.querySelector('input, textarea');
                const btnContainer = container.querySelector('.el-form-item__content > div');

                // 使用 class 判断是否已注入，避免 ID 冲突
                if (input && btnContainer && !btnContainer.querySelector('.fetch-douban-btn-1')) {
                    initButton1(input, btnContainer);
                }
            }
        });

        // 模块 2：根据 Placeholder 注入
        const urlInputs2 = document.querySelectorAll('input[placeholder="请输入豆瓣链接"]');
        urlInputs2.forEach(inputEl => {
            const container = inputEl.closest('.el-form-item__content')?.children[0];
            if (container && !container.querySelector('.fetch-douban-btn-2')) {
                createBtn2(inputEl, container);
            }
        });
    }

    // --- 3. 核心抓取与解析逻辑 (统一抽象) ---
    function fetchDoubanInfo(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: { "User-Agent": navigator.userAgent, "Referer": "https://movie.douban.com/" },
                onload: function(response) {
                    if (response.status !== 200) {
                        return reject(`请求失败，状态码: ${response.status}`);
                    }

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, "text/html");
                    const htmlStr = response.responseText;
                    const infoText = doc.querySelector('#info')?.innerText || "";

                    // 提取基础信息
                    const fullTitle = doc.querySelector('h1 span[property="v:itemreviewed"]')?.innerText.trim() || "";
                    const year = doc.querySelector('h1 .year')?.innerText.replace(/\(|\)/g, '') || "";

                    // 解析名字和季份
                    let { chineseName, englishName, seasonTag } = parseTitleAndSeason(fullTitle);

                    // 如果提取出的英文名不是有效的英文（比如全是汉字/日文/韩文），则置空
                    if (englishName && (!/[a-zA-Z]/.test(englishName) || /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(englishName))) {
                        englishName = "";
                    }

                    if (!englishName) {
                        englishName = findEnglishFromAKA(infoText);
                    }

                    // 其他信息
                    const otherNames = findOtherNamesFromAKA(infoText);
                    const rawLang = htmlStr.match(/语言:<\/span>\s*([^<]+)/)?.[1]?.split('/')[0]?.trim() || infoText.match(/语言:\s*(.*)/)?.[1]?.split('/')[0] || "未知";
                    const epMatch = htmlStr.match(/集数:<\/span>\s*(\d+)/) || infoText.match(/集数:\s*(\d+)/);

                    const directors = Array.from(doc.querySelectorAll('a[rel="v:directedBy"]')).map(a => a.innerText.trim()).join(' ');
                    const actors = Array.from(doc.querySelectorAll('a[rel="v:starring"]')).slice(0, 5).map(a => a.innerText.trim()).join(' ');

                    resolve({
                        "中文名": chineseName,
                        "英文名": cleanEnglishName(englishName),
                        "年份": year,
                        "季": seasonTag,
                        "又名": otherNames,
                        "总集数": epMatch ? epMatch[1] : "1",
                        "下载集数": '0', // 默认值
                        "导演": directors ? `导演: ${directors}` : "",
                        "主演": actors ? `主演: ${actors}` : "",
                        "语言字幕": formatLanguageTag(rawLang),
                        "地区": htmlStr.match(/制片国家\/地区:<\/span>\s*([^<]+)/)?.[1]?.trim() || "",
                        "豆瓣所有类型": Array.from(doc.querySelectorAll('span[property="v:genre"]')).map(s => s.innerText.trim()),
                        "是否有集数": htmlStr.includes("集数:") || infoText.includes("集数:")
                    });
                },
                onerror: (err) => reject("网络请求异常: " + (err.error || "未知")),
                ontimeout: () => reject("网络请求超时")
            });
        });
    }

    // ================= 模块 1 =================
    function initButton1(doubanInput, btnContainer) {
        const fetchBtn = document.createElement('button');
        fetchBtn.type = 'button';
        fetchBtn.className = 'el-button el-button--primary fetch-douban-btn-1'; // 添加特有 class
        fetchBtn.style.marginRight = '10px';
        fetchBtn.innerHTML = '<span>自动填写</span>';
        btnContainer.insertBefore(fetchBtn, btnContainer.firstChild);

        fetchBtn.addEventListener('click', async () => {
            const url = doubanInput.value.trim();
            if (!url.includes('douban.com/subject/')) return alert('请先输入有效的豆瓣链接！');

            fetchBtn.innerHTML = '<span>请求中...</span>';
            fetchBtn.disabled = true;

            try {
                const data = await fetchDoubanInfo(url);
                // 模块 1 只需要部分数据
                autoFill('中文名', data["中文名"]);
                autoFill('英文名', data["英文名"]);
                autoFill('年份', data["年份"]);
                autoFill('季', data["季"]);
                autoFill('语言字幕', data["语言字幕"]);
                autoFill('下载集数', data["下载集数"]);
                autoFill('总集数', data["总集数"]);
            } catch (error) {
                alert("抓取失败: " + error);
            } finally {
                fetchBtn.innerHTML = '<span>自动填写</span>';
                fetchBtn.disabled = false;
            }
        });
    }

    // ================= 模块 2 =================
    function createBtn2(inputEl, container) {
        const btn = document.createElement('button');
        btn.innerText = '脚本解析';
        btn.type = 'button';
        btn.className = 'fetch-douban-btn-2'; // 添加特有 class
        btn.style.cssText = `margin-left: 10px; padding: 8px 15px; background-color: #67c23a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; flex-shrink: 0;`;
        container.appendChild(btn);

        btn.onclick = async function() {
            const url = inputEl.value.trim();
            if (!url) return alert('请先输入豆瓣链接');

            btn.innerText = '解析中...';
            btn.disabled = true;

            try {
                const data = await fetchDoubanInfo(url);
                await fillForm2(data, inputEl.closest('.el-overlay-dialog') || document);
            } catch (error) {
                alert("抓取失败: " + error);
            } finally {
                btn.innerText = '脚本解析';
                btn.disabled = false;
            }
        };
    }

    // --- 辅助工具函数 ---

    // 支持更长的中文数字，比如 "十一"
    function chineseToNum(str) {
        const map = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
        if (str.length === 1) return map[str] || str;
        if (str.startsWith('十')) return 10 + (map[str[1]] || 0); // 处理 十一、十二
        return str; // 更复杂的数字暂不处理，直接返回原字符串
    }

    function parseTitleAndSeason(fullTitle) {
        let chineseName = "";
        let englishName = "";
        let seasonTag = "S01";

        // 优化正则，匹配可能出现的多位中文或数字
        const seasonMatch = fullTitle.match(/第([一二三四五六七八九十\d]+)季/);
        if (seasonMatch) {
            const endPos = seasonMatch.index + seasonMatch[0].length;
            chineseName = fullTitle.substring(0, endPos).trim();
            englishName = fullTitle.substring(endPos).trim();
            const num = isNaN(seasonMatch[1]) ? chineseToNum(seasonMatch[1]) : parseInt(seasonMatch[1]);
            seasonTag = `S${num.toString().padStart(2, '0')}`;
        } else {
            const parts = fullTitle.split(' ');
            if (parts.length === 1) {
                chineseName = fullTitle;
            } else {
                let splitPos = -1;
                let currentLen = parts[0].length;
                for (let i = 1; i < parts.length; i++) {
                    if (/^\d+[dD]$/.test(parts[i])) {
                        currentLen += 1 + parts[i].length;
                        continue;
                    }
                    if (/[a-zA-Z\u3040-\u30ff\uac00-\ud7af]/.test(parts[i])) {
                        splitPos = currentLen;
                        break;
                    }
                    currentLen += 1 + parts[i].length;
                }

                if (splitPos === -1) {
                    let len = 0;
                    for (let i = 0; i < parts.length - 1; i++) {
                        len += parts[i].length;
                        if (!/^\d+$/.test(parts[i+1])) {
                            splitPos = len;
                            break;
                        }
                        len += 1;
                    }
                }

                if (splitPos !== -1) {
                    chineseName = fullTitle.substring(0, splitPos).trim();
                    englishName = fullTitle.substring(splitPos).trim();
                } else {
                    chineseName = fullTitle;
                }
            }
        }

        chineseName = chineseName.match(/[\u4e00-\u9fa50-9a-zA-Z\s！，？：；“”（）《》·!！～~、\-]+/g)?.join('').trim() || chineseName;
        if (englishName) {
            englishName = englishName.replace(/Season\s*\d+/i, '').replace(/S\d+/i, '').replace(/\(\d{4}\)/, '').trim();
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
                return name.replace(/Season\s*\d+/i, '').replace(/S\d+/i, '').trim();
            }
        }
        return "";
    }

    function findOtherNamesFromAKA(infoText) {
        const akaMatch = infoText.match(/又名:\s*(.*)/);
        if (!akaMatch) return "";
        return akaMatch[1].split('/')
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

    // 获取 Label 并填充的公用方法
    function getInputByLabel(labelText, scope = document) {
        const labels = Array.from(scope.querySelectorAll('.el-form-item__label'));
        const targetLabel = labels.find(el => el.textContent.trim().includes(labelText));
        return targetLabel ? targetLabel.closest('.el-form-item').querySelector('input, textarea') : null;
    }

    function autoFill(label, value, scope = document) {
        const input = getInputByLabel(label, scope);
        if (input && value) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // 限定范围，避免填充到页面背后的表单
    async function fillForm2(data, dialogScope) {
        const items = dialogScope.querySelectorAll('.el-form-item');
        for (const item of items) {
            const label = item.querySelector('.el-form-item__label')?.innerText.trim();
            if (!label) continue;

            const input = item.querySelector('input.el-input__inner, textarea');
            if (input && data[label] && label !== "类型") {
                input.value = data[label];
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (label === "类型") {
                await fillSelectWithStrictPriority2(item, data);
            }
        }
    }

    async function fillSelectWithStrictPriority2(itemContainer, data) {
        const selectWrapper = itemContainer.querySelector('.el-select__wrapper');
        if (!selectWrapper) return;

        const genres = data["豆瓣所有类型"];
        const hasEpisodes = data["是否有集数"];
        let targetValue = genres.includes("动画") ? "动漫" :
        genres.includes("纪录片") ? "纪录" :
        genres.some(g => ["真人秀", "脱口秀"].includes(g)) ? "综艺" :
        (hasEpisodes ? "电视剧" : "电影");

        selectWrapper.click(); // 触发下拉框弹出

        let found = false;
        // 缩短了轮询间隔，提升反应速度
        for (let i = 0; i < 20; i++) {
            await sleep(100);
            const options = document.querySelectorAll('.el-select-dropdown__item');
            for (let opt of options) {
                if (opt.innerText.trim() === targetValue) {
                    opt.click();
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        // 兜底：收起下拉框
        setTimeout(() => { document.body.click(); }, 100);
    }
})();
