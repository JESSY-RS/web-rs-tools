import urllib.request
import urllib.parse
import json
import re

# ============================================
# 設定項目
INPUT_FILENAME = 'links.txt'      # 元のデータが入ったテキストファイル名
OUTPUT_FILENAME = 'repeat.html' # 完成したHTMLファイル名
# ============================================

def get_toc_class(heading_text):
    """見出しのテキストに基づいてCSSクラスを返す"""
    if "単2R" in heading_text: return "group-tan2r"
    if "全2R" in heading_text: return "group-zen2r"
    if "縦2R" in heading_text: return "group-tate2r"
    if "横2R" in heading_text: return "group-yoko2r"
    if "単1R" in heading_text: return "group-tan1r"
    if "全1R" in heading_text: return "group-zen1r"
    if "縦1R" in heading_text: return "group-tate1r"
    if "横1R" in heading_text: return "group-yoko1r"
    if "関門クエスト" in heading_text or getattr(get_toc_class, 'is_kanmon_section', False):
        get_toc_class.is_kanmon_section = True
        return "group-kanmon"
    return ""

def create_html_from_text(input_text):
    """入力テキストを解析して完全なHTMLページを生成する"""
    lines = input_text.split('\n')
    url_pattern = re.compile(r'https?://[xtwitter]+\.com/\S+')

    # 最後のツイートURLを事前に見つけておく
    last_tweet_url = None
    for line in reversed(lines):
        urls_in_line = url_pattern.findall(line.strip())
        if urls_in_line:
            last_tweet_url = urls_in_line[-1]
            break

    sections = []
    current_section = None
    for line in lines:
        stripped_line = line.strip()
        if stripped_line.startswith('▼'):
            current_section = {
                'heading_line': stripped_line,
                'has_tweets': False,
                'content_lines': []
            }
            sections.append(current_section)
        elif current_section:
            current_section['content_lines'].append(line)
            if url_pattern.search(line):
                current_section['has_tweets'] = True

    setattr(get_toc_class, 'is_kanmon_section', False)
    toc_list_items = ""
    for section in sections:
        heading_line = section['heading_line']
        has_tweets = section['has_tweets']
        
        full_heading_text = heading_line.strip('▼').strip()
        anchor_text = full_heading_text.replace("　★更新終了", "").strip()
        display_text = anchor_text
        href_id = urllib.parse.quote(anchor_text)
        
        css_class = get_toc_class(full_heading_text)
        
        is_disabled = not has_tweets and "group-kanmon" not in css_class
        li_class = f'{css_class} {"disabled" if is_disabled else ""}'.strip()
        
        toc_list_items += f'        <li class="{li_class}"><a href="#{href_id}">{display_text}</a></li>\n'

    body_content = ""
    is_kanmon_section = False
    for section in sections:
        heading_line = section['heading_line']
        heading_text = heading_line.strip('▼').strip()
        
        anchor_text = heading_text.replace("　★更新終了", "").strip()
        section_id = urllib.parse.quote(anchor_text)
        
        top_link_html = '<a href="#top" class="heading-top-link web-link">▲TOPへ戻る</a>'
        
        current_is_kanmon = False
        if "関門クエスト" in heading_line:
            if not is_kanmon_section:
                is_kanmon_section = True
                body_content += f'    <h2 id="{section_id}">{heading_line}{top_link_html}</h2>\n'
            else:
                body_content += f'    <h3 id="{section_id}">{heading_line}{top_link_html}</h3>\n'
            current_is_kanmon = True
        elif is_kanmon_section and not any(kw in heading_line for kw in ["単2R", "全2R", "縦2R", "横2R", "単1R", "全1R", "縦1R", "横1R"]):
            body_content += f'    <h3 id="{section_id}">{heading_line}{top_link_html}</h3>\n'
            current_is_kanmon = True
        else:
            is_kanmon_section = False
            body_content += f'    <h2 id="{section_id}">{heading_line}{top_link_html}</h2>\n'
            current_is_kanmon = False

        container_class = "kanmon-container" if current_is_kanmon else ""
        body_content += f'    <div class="tweet-container {container_class}">\n'
            
        description_buffer = ""
        for line in section['content_lines']:
            stripped_line = line.strip()
            if not stripped_line or "周回編成参考" in stripped_line or '\t' in stripped_line:
                continue

            urls = url_pattern.findall(stripped_line)
            text_part = url_pattern.sub('', stripped_line).strip()

            if not urls:
                if description_buffer:
                    description_buffer += f"<br>{text_part}"
                else:
                    description_buffer = text_part
            else:
                final_description = description_buffer
                if text_part:
                    if final_description:
                        final_description += f"<br>{text_part}"
                    else:
                        final_description = text_part
                
                body_content += '        <div class="tweet-item">\n'
                if final_description:
                    body_content += f'            <p style="margin-bottom: 5px;">{final_description}</p>\n'
                
                for url in urls:
                    is_last_marker = ' data-is-last="true"' if url == last_tweet_url else ''
                    loading_message = "ツイートを読み込み中..."
                    body_content += f'            <div class="lazy-tweet" data-tweet-url="{url}"{is_last_marker}><p>{loading_message}</p></div>\n'
                body_content += '        </div>\n'
                
                description_buffer = ""
        
        body_content += '    </div>\n'

    # --- HTMLテンプレート ---
    html_template = f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="shortcut icon" href="favicon-kiokucalc.ico">
    <link rel="apple-touch-icon" href="apple-touch-icon-kiokucalc.png">
    <link rel="icon" type="image/png" href="android-chrome-144x144-kiokucalc.png">
    <title>周回編成まとめ</title>
    <style>
        body {{
            font-family: sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 0;
            background: #fff;
            color: #333;
            transition: background-color 0.3s, color 0.3s;
            
            --web-link-text: dodgerblue;
            --web-link-visited: blueviolet;
            --web-link-hover: lime;
            --web-link-active: orangered;
        }}
        body.dark {{
            background: #2A2A2A;
            color: #e0e0e0;

            --web-link-text: #1D9BF0;
            --web-link-visited: #7755FF;
            --web-link-hover: #0CFF57;
            --web-link-active: #FF0000;
        }}
        #page-wrapper {{
            max-width: 1200px;
            margin: 0 auto;
            padding: 15px;
        }}
        #page-wrapper p {{
            margin-top: 5px;
        }}
        h1 {{
            display: flex;
            align-items: center;
            border-bottom: 2px solid #ccc;
            position: relative;
            margin-top: 0;
        }}
        body.dark h1,
        body.dark h2 {{
            border-bottom-color: #444;
        }}
        h2,
        h3 {{
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}
        .heading-top-link {{
            font-size: 0.8em;
            font-weight: normal;
            white-space: nowrap;
            margin-left: 1em;
        }}
        h2 {{
            margin-top: 30px;
            border-bottom: 2px solid #ccc;
            padding-bottom: 10px;
        }}
        h3 {{
            margin-top: 30px;
            padding: 5px 10px;
            border-top: 1px solid #ccc;
            border-bottom: 1px solid #ccc;
            border-left: 5px solid #ccc;
            border-right: 5px solid #ccc;
        }}
        body.dark h3 {{
            border-color: #555;
        }}
        .toc {{
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            list-style: none;
            padding: 0;
            margin-bottom: 40px;
        }}
        .toc li {{
            border-radius: 5px;
            transition: filter 0.2s, opacity 0.2s;
        }}
        .toc li:not(.disabled):hover {{
            filter: brightness(105%);
        }}
        .toc a {{
            text-decoration: none;
            font-weight: bold;
            display: block;
            padding: 10px;
            color: #333;
        }}
        body.dark .toc a {{
            color: #e0e0e0;
        }}
        .toc li.disabled {{
            background-color: #f8f9fa !important;
            cursor: not-allowed;
            opacity: 0.6;
        }}
        .toc li.disabled a {{
            color: #adb5bd;
            pointer-events: none;
        }}
        body.dark .toc li.disabled {{
            background-color: #343a40 !important;
            opacity: 0.5;
        }}
        body.dark .toc li.disabled a {{
            color: #adb5bd;
        }}
        blockquote.twitter-tweet {{
            margin: 10px 0 20px 0 !important;
        }}
        /* ▼▼▼ 修正箇所1 ▼▼▼ */
        /* Twitterの埋め込みスタイルを上書きして、読み込み後の下部マージンを減らす */
        .tweet-item blockquote.twitter-tweet {{
            margin-bottom: 10px !important;
        }}
        /* ▲▲▲ 修正ここまで ▲▲▲ */
        .lazy-tweet {{
            min-height: 100px;
            border: 2px dashed #ccc;
            border-radius: 12px;
            display: flex;
            align-items: center;
            margin: 10px 0;
        }}
        .lazy-tweet p {{
            padding-left: 1em;
            white-space: nowrap;
            margin: 0;
            /* ▼▼▼ 修正箇所（ここから）▼▼▼ */
            line-height: 1; /* 行の高さを詰めて、より厳密な中央揃えを目指す */
            /* ▲▲▲ 修正箇所（ここまで）▲▲▲ */
        }}
        body.dark .lazy-tweet {{
            border-color: #555;
        }}
        /* ▼▼▼ 修正箇所2 ▼▼▼ */
        p+.lazy-tweet {{
            margin-top: -8px;
        }}
        /* ▲▲▲ 修正ここまで ▲▲▲ */
        .tweet-item {{
            break-inside: avoid;
            page-break-inside: avoid;
        }}
        @media (min-width: 1200px) {{
            .toc {{
                grid-template-columns: repeat(8, 1fr);
            }}
            .tweet-container {{
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 20px;
                align-items: start;
            }}
            .tweet-container > p {{
                grid-column: 1 / -1;
            }}
        }}
        .group-tan2r {{ background-color: #ffcdd2; }}
        .group-zen2r {{ background-color: #b2ebf2; }}
        .group-tate2r {{ background-color: #c8e6c9; }}
        .group-yoko2r {{ background-color: #ffe0b2; }}
        .group-tan1r {{ background-color: #e1bee7; }}
        .group-zen1r {{ background-color: #b3e5fc; }}
        .group-tate1r {{ background-color: #fff9c4; }}
        .group-yoko1r {{ background-color: #f8bbd0; }}
        .group-kanmon {{ background-color: #e8e8e8; }}
        body.dark .group-tan2r {{ background-color: #5c2b29; }}
        body.dark .group-zen2r {{ background-color: #1e454d; }}
        body.dark .group-tate2r {{ background-color: #28442a; }}
        body.dark .group-yoko2r {{ background-color: #5e4328; }}
        body.dark .group-tan1r {{ background-color: #4e2f54; }}
        body.dark .group-zen1r {{ background-color: #224554; }}
        body.dark .group-tate1r {{ background-color: #5e5b29; }}
        body.dark .group-yoko1r {{ background-color: #5c2a3d; }}
        body.dark .group-kanmon {{ background-color: #555555; }}
        #theme-toggle-button {{
            cursor: pointer;
            color: #f5c542;
            user-select: none;
            margin-right: 0px;
        }}
        #theme-options {{
            display: none;
            position: absolute;
            left: 0;
            margin-top: 8px;
            padding: 1rem;
            background-color: #fff;
            border: 1px solid #a0aec0;
            border-radius: 0.5rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            z-index: 20;
            top: 100%;
        }}
        body.dark #theme-options {{
            background-color: #4a4a4a;
            border-color: #666;
        }}
        #theme-options div {{
            display: flex;
            flex-direction: column;
        }}
        #theme-options label {{
            display: flex;
            align-items: center;
            margin-top: 0.5rem;
        }}
        #theme-options label:first-child {{
            margin-top: 0;
        }}
        #theme-options span {{
            margin-left: 0.5rem;
            font-size: 1rem;
        }}
        .zoom-buttons {{
            position: absolute;
            top: 0;
            right: 0;
            display: flex;
            gap: 5px;
            z-index: 10;
            margin-top: 5px;
        }}
        .zoom-buttons button {{
            color: #000;
            background-color: #eee;
            padding: 5px 10px;
            font-size: 16px;
            cursor: pointer;
            border-radius: 5px;
            border: 1px solid #ccc;
        }}
        #footer-spacer {{
            transition: height 0.5s ease-in-out;
        }}
        .bottom {{
            margin-top: 0px;
            margin-bottom: 20px;
            font-size: 16pt;
            line-height: 2;
            text-align: left;
        }}
        .web-link, .web-link:link {{
            color: var(--web-link-text);
            text-decoration: underline;
        }}
        .web-link:visited {{
            color: var(--web-link-visited);
        }}
        .web-link:hover {{
            color: var(--web-link-hover);
        }}
        .web-link:active {{
            color: var(--web-link-active);
        }}
    </style>
</head>
<body id="top">
    <div id="page-wrapper">
        <h1>
            <div style="flex-grow: 1;">
                <span id="theme-toggle-button">★</span>周回編成まとめ
            </div>
            <div id="theme-options">
                <div>
                    <label><input type="radio" name="theme" value="system"><span>端末の設定を使う</span></label>
                    <label><input type="radio" name="theme" value="dark"><span>ダークモード ON</span></label>
                    <label><input type="radio" name="theme" value="light"><span>ダークモード OFF</span></label>
                </div>
            </div>
            <div class="zoom-buttons">
                <button onclick="changeZoom(-0.1)">－</button>
                <button onclick="changeZoom(0.1)">＋</button>
            </div>
        </h1>
        <h2>目次</h2>
        <ul class="toc">
{toc_list_items}
        </ul>
{body_content}
    
        <div id="footer-spacer" style="height: 900px;"></div>
        
        <div class="bottom">
            <a href="index.html" class="web-link">INDEXへ戻る</a>
        </div>
    </div>

    <script>
        const PAGE_SETTING_KEY = 'PageSettings';
        let pageSettings = {{
            'repeat_zoom': 1.0
        }};
        function changeZoom(delta) {{
            const zoomKey = 'repeat_zoom';
            let currentZoom = pageSettings[zoomKey] || 1.0;
            currentZoom += delta;
            currentZoom = Math.round(currentZoom * 10) / 10;
            if (currentZoom < 0.5) currentZoom = 0.5;
            if (currentZoom > 2.0) currentZoom = 2.0;
            
            document.body.style.zoom = currentZoom;
            
            pageSettings[zoomKey] = currentZoom;
            savePageSettings();
        }}
        function loadPageSettings() {{
            try {{
                const savedSettings = localStorage.getItem(PAGE_SETTING_KEY);
                if (savedSettings) {{
                    pageSettings = {{ ...pageSettings, ...JSON.parse(savedSettings) }};
                }}
            }} catch (error) {{
                console.error("ページ設定の読み込みに失敗しました:", error);
            }}
        }}
        function savePageSettings() {{
            try {{
                localStorage.setItem(PAGE_SETTING_KEY, JSON.stringify(pageSettings));
            }} catch (error) {{
                console.error("ページ設定の保存に失敗しました:", error);
            }}
        }}
        document.addEventListener("DOMContentLoaded", function() {{
            const body = document.body;
            const themeToggleButton = document.getElementById('theme-toggle-button');
            const themeOptions = document.getElementById('theme-options');
            const themeRadios = document.querySelectorAll('input[name="theme"]');
            
            const ua = navigator.userAgent;
            const isAppleMobile = /iPhone|iPad|iPod/i.test(ua);
            const isThirdPartyBrowserOnIos = /CriOS|FxiOS|EdgiOS/i.test(ua);
            const isAppleSafari = isAppleMobile && !isThirdPartyBrowserOnIos;
            let anchorTargetId = null;
            let scrollCorrectionTimeout = null;
            
            loadPageSettings();
            
            const initialZoom = pageSettings['repeat_zoom'] || 1.0;
            document.body.style.zoom = initialZoom;
            if (isAppleSafari) {{
                document.querySelectorAll('.toc a').forEach(anchor => {{
                    anchor.addEventListener('click', function(e) {{
                        const href = this.getAttribute('href');
                        if (href && href.startsWith('#')) {{
                            anchorTargetId = href.substring(1);
                            if (scrollCorrectionTimeout) {{
                                clearTimeout(scrollCorrectionTimeout);
                            }}
                            scrollCorrectionTimeout = setTimeout(() => {{
                                anchorTargetId = null;
                            }}, 2500);
                        }}
                    }});
                }});
            }}
            function getCurrentTheme() {{
                const savedTheme = localStorage.getItem("theme") || "system";
                const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                if (savedTheme === 'dark') return 'dark';
                if (savedTheme === 'light') return 'light';
                return prefersDark ? 'dark' : 'light';
            }}
            function applyPageTheme() {{
                if (getCurrentTheme() === 'dark') {{
                    body.classList.add("dark");
                }} else {{
                    body.classList.remove("dark");
                }}
            }}
            function updateAllExistingTweets() {{
                const theme = getCurrentTheme();
                const allIframes = document.querySelectorAll('iframe[id^="twitter-widget-"]');
                allIframes.forEach(iframe => {{
                    try {{
                        const src = new URL(iframe.src);
                        if (src.searchParams.get('theme') !== theme) {{
                            src.searchParams.set('theme', theme);
                            iframe.src = src.toString();
                        }}
                    }} catch (e) {{
                        console.error("Could not update tweet theme:", e);
                    }}
                }});
            }}
            function initializeTwitterLazyLoader() {{
                const lazyTweets = document.querySelectorAll('.lazy-tweet');
                if (lazyTweets.length === 0) {{
                    const footerSpacer = document.getElementById('footer-spacer');
                    if(footerSpacer) footerSpacer.style.height = '0px';
                    return;
                }}
                
                const processLazyTweets = (entries, observer) => {{
                    entries.forEach(entry => {{
                        if (entry.isIntersecting) {{
                            const placeholder = entry.target;
                            const tweetUrl = placeholder.dataset.tweetUrl;
                            
                            window.twttr.widgets.createTweet(
                                tweetUrl.split('/').pop().split('?')[0],
                                placeholder, {{
                                    theme: getCurrentTheme(),
                                    dnt: true,
                                    lang: 'ja'
                                }}
                            ).then(el => {{
                                if (el) {{
                                    placeholder.style.minHeight = '0';
                                    placeholder.style.border = 'none';
                                    const loadingP = placeholder.querySelector('p');
                                    if(loadingP) loadingP.remove();
                                }} else {{
                                    placeholder.innerHTML = `<p style="color:red;">ツイートを読み込めませんでした。<br>（削除されたか、URLが間違っている可能性があります）</p>`;
                                }}
                            }}).catch(error => {{
                                console.error("Error creating tweet:", tweetUrl, error);
                                placeholder.innerHTML = `<p style="color:red;">ツイートの読み込み中にエラーが発生しました。</p>`;
                            }}).finally(() => {{
                                if (placeholder.dataset.isLast === 'true') {{
                                    const footerSpacer = document.getElementById('footer-spacer');
                                    if (footerSpacer) {{
                                        footerSpacer.style.height = '0px';
                                    }}
                                }}
                                if (isAppleSafari && anchorTargetId) {{
                                    setTimeout(() => {{
                                        if (!anchorTargetId) return;
                                        try {{
                                            const targetElement = document.getElementById(anchorTargetId);
                                            if (targetElement) {{
                                                targetElement.scrollIntoView({{ behavior: 'auto', block: 'start' }});
                                            }}
                                        }} catch (e) {{
                                            console.error("Error finding target element for scroll correction:", e);
                                            anchorTargetId = null;
                                        }}
                                    }}, 300);
                                }}
                            }});
                            observer.unobserve(placeholder);
                        }}
                    }});
                }};
                const observer = new IntersectionObserver(processLazyTweets, {{
                    rootMargin: '200px 0px'
                }});
                
                lazyTweets.forEach(tweet => {{
                    observer.observe(tweet);
                }});
            }}
            function handleTwitterScriptError() {{
                console.error("TwitterのJSファイル(widgets.js)の読み込みに失敗しました。");
                document.querySelectorAll('.lazy-tweet').forEach(placeholder => {{
                    placeholder.innerHTML = `<p style="color:red; text-align:center;">Twitterの読み込みに失敗しました。<br>広告ブロック機能などが原因の可能性があります。</p>`;
                }});
                const footerSpacer = document.getElementById('footer-spacer');
                if (footerSpacer) footerSpacer.style.height = '0px';
            }}
            themeToggleButton.addEventListener('click', (e) => {{
                e.stopPropagation();
                themeOptions.style.display = themeOptions.style.display === 'block' ? 'none' : 'block';
            }});
            document.addEventListener('click', (e) => {{
                if (!themeOptions.contains(e.target) && e.target !== themeToggleButton) {{
                    themeOptions.style.display = 'none';
                }}
            }});
            themeRadios.forEach(radio => {{
                radio.addEventListener('change', (e) => {{
                    localStorage.setItem('theme', e.target.value);
                    applyPageTheme();
                    updateAllExistingTweets();
                }});
            }});
            window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {{
                const currentSetting = localStorage.getItem("theme") || "system";
                if (currentSetting === "system") {{
                    applyPageTheme();
                    updateAllExistingTweets();
                }}
            }});
            applyPageTheme();
            const savedRadioValue = localStorage.getItem("theme") || "system";
            for (const radio of themeRadios) {{
                if (radio.value === savedRadioValue) {{
                    radio.checked = true;
                }}
            }}
            window.twttr = (function(d, s, id) {{
                var js, fjs = d.getElementsByTagName(s)[0],
                    t = window.twttr || {{}};
                if (d.getElementById(id)) return t;
                js = d.createElement(s);
js.id = id;
                js.src = "https://platform.twitter.com/widgets.js";
                js.onload = function() {{
                    window.twttr.ready(initializeTwitterLazyLoader);
                }};
                js.onerror = handleTwitterScriptError;
                fjs.parentNode.insertBefore(js, fjs);
                t._e = [];
                t.ready = function(f) {{
                    t._e.push(f);
                }};
                return t;
            }}(document, "script", "twitter-wjs"));
        }});
    </script>
</body>
</html>"""
    return html_template

# --- メイン処理 ---
if __name__ == "__main__":
    print(f"'{INPUT_FILENAME}' を読み込んでいます...")
    try:
        with open(INPUT_FILENAME, 'r', encoding='utf-8') as f:
            text_data = f.read()
        print("HTMLを生成しています...")
        final_html = create_html_from_text(text_data)
        with open(OUTPUT_FILENAME, 'w', encoding='utf-8') as f:
            f.write(final_html)
        print(f"\n完了しました！ '{OUTPUT_FILENAME}' が生成されました。")
    except FileNotFoundError:
        print(f"[エラー] '{INPUT_FILENAME}' が見つかりません。スクリプトと同じ場所に作成してください。")
    except Exception as e:
        print(f"予期せぬエラーが発生しました: {e}")