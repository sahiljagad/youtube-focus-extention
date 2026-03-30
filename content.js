console.log("YouTube Watch Later Enhancer: Content script loaded");

// Configuration
const CONFIG = {
    SYNC_INTERVAL: 5 * 60 * 1000, // 5 minutes
    MAX_PAGINATION_REQUESTS: 50, // enough for ~5000 videos at 100/page
};

// Current UI state
let currentSort = "default"; // default | title | duration | channel
let currentSearch = "";

// Helper function to extract YouTube video ID from URL
function getYouTubeVideoID(url) {
    if (!url) return "";
    const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})/);
    return match ? (match[1] || match[2]) : "";
}

// Helper function to detect if YouTube is in dark mode
function isDarkMode() {
    const htmlElement = document.documentElement;
    const computedStyle = window.getComputedStyle(htmlElement);
    const bgColor = computedStyle.backgroundColor;

    if (bgColor.startsWith('rgb')) {
        const rgb = bgColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const brightness = (parseInt(rgb[0]) + parseInt(rgb[1]) + parseInt(rgb[2])) / 3;
            return brightness < 128;
        }
    }

    return htmlElement.hasAttribute('dark') ||
           htmlElement.classList.contains('dark') ||
           document.body.classList.contains('dark');
}

// Parse a duration string like "12:34" or "1:02:34" into total seconds
function parseDuration(str) {
    if (!str) return 0;
    const parts = str.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

// Extract innertube config (API key + client context) from YouTube page HTML
function extractInnertubeConfig(html) {
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    const visitorDataMatch = html.match(/"visitorData":"([^"]+)"/);

    if (!apiKeyMatch) return null;

    return {
        apiKey: apiKeyMatch[1],
        clientVersion: clientVersionMatch ? clientVersionMatch[1] : "2.20240101.00.00",
        visitorData: visitorDataMatch ? visitorDataMatch[1] : null,
    };
}

// Extract ytInitialData JSON from YouTube page HTML
function extractInitialData(html) {
    const match = html.match(/var ytInitialData\s*=\s*({.+?});\s*<\/script/s);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

// Recursively find a continuation token anywhere in a data structure
function findContinuationToken(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.token && obj.token.length > 20) return obj.token;
    if (obj.continuationCommand?.token) return obj.continuationCommand.token;
    for (const val of Object.values(obj)) {
        if (typeof val === "object") {
            const found = findContinuationToken(val);
            if (found) return found;
        }
    }
    return null;
}

// Extract video data from a playlistVideoRenderer
function parseVideoRenderer(renderer) {
    if (!renderer?.videoId) return null;
    const videoId = renderer.videoId;
    const channel = renderer.shortBylineText?.runs?.[0]?.text || null;
    return {
        title: renderer.title?.runs?.[0]?.text || renderer.title?.simpleText || "Unknown Title",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
        channel,
        thumbnail: renderer.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
                   `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        duration: renderer.lengthText?.simpleText || renderer.lengthText?.runs?.[0]?.text || null,
    };
}

// Extract playlist video items from YouTube's initial data structure
function extractPlaylistItems(data) {
    const items = [];

    const contents =
        data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
            ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
            ?.itemSectionRenderer?.contents?.[0]
            ?.playlistVideoListRenderer?.contents || [];

    for (const item of contents) {
        const video = parseVideoRenderer(item?.playlistVideoRenderer);
        if (video) items.push(video);
    }

    // Find continuation token — check the last item and also search recursively
    let continuationToken = null;
    const lastItem = contents[contents.length - 1];
    if (lastItem?.continuationItemRenderer) {
        continuationToken = findContinuationToken(lastItem.continuationItemRenderer);
    }

    return { items, continuationToken };
}

// Extract playlist items from a browse API continuation response
function extractContinuationItems(data) {
    const items = [];
    let continuationToken = null;

    // Path 1: onResponseReceivedActions (newer format)
    const actions = data?.onResponseReceivedActions || [];
    for (const action of actions) {
        const continuationItems =
            action?.appendContinuationItemsAction?.continuationItems ||
            action?.reloadContinuationItemsCommand?.continuationItems || [];

        for (const item of continuationItems) {
            const video = parseVideoRenderer(item?.playlistVideoRenderer);
            if (video) {
                items.push(video);
            } else if (item?.continuationItemRenderer) {
                continuationToken = findContinuationToken(item.continuationItemRenderer);
            }
        }
    }

    // Path 2: continuationContents (older/playlist format)
    if (items.length === 0) {
        const continuation = data?.continuationContents?.playlistVideoListContinuation;
        if (continuation) {
            const contents = continuation.contents || [];
            for (const item of contents) {
                const video = parseVideoRenderer(item?.playlistVideoRenderer);
                if (video) items.push(video);
            }
            // Continuation token in this format
            const continuations = continuation.continuations;
            if (continuations) {
                continuationToken = findContinuationToken(continuations);
            }
        }
    }

    return { items, continuationToken };
}

// Fetch all Watch Later videos using background fetch + innertube pagination
async function fetchWatchLaterVideos() {
    console.log("Fetching Watch Later videos via background fetch...");

    const response = await fetch("https://www.youtube.com/playlist?list=WL", {
        credentials: "include",
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch Watch Later page: ${response.status}`);
    }

    const html = await response.text();
    const initialData = extractInitialData(html);
    if (!initialData) {
        throw new Error("Could not extract ytInitialData from Watch Later page");
    }

    const config = extractInnertubeConfig(html);
    if (!config) {
        throw new Error("Could not extract innertube API key from Watch Later page");
    }

    // Extract first page
    const firstPage = extractPlaylistItems(initialData);
    const allVideos = [...firstPage.items];
    let continuationToken = firstPage.continuationToken;

    console.log(`First page: ${firstPage.items.length} videos, has continuation: ${!!continuationToken}`);

    // Paginate using the innertube browse API
    let pageCount = 0;
    while (continuationToken && pageCount < CONFIG.MAX_PAGINATION_REQUESTS) {
        pageCount++;

        const clientContext = {
            clientName: "WEB",
            clientVersion: config.clientVersion,
        };
        if (config.visitorData) {
            clientContext.visitorData = config.visitorData;
        }

        const browseResponse = await fetch(
            `https://www.youtube.com/youtubei/v1/browse?key=${config.apiKey}&prettyPrint=false`,
            {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    context: { client: clientContext },
                    continuation: continuationToken,
                }),
            }
        );

        if (!browseResponse.ok) {
            console.warn(`Continuation request failed: ${browseResponse.status}`);
            break;
        }

        const browseData = await browseResponse.json();
        console.log("Browse response keys:", Object.keys(browseData));
        const page = extractContinuationItems(browseData);
        allVideos.push(...page.items);
        continuationToken = page.continuationToken;

        console.log(`Page ${pageCount}: +${page.items.length} videos (total: ${allVideos.length}), more: ${!!continuationToken}`);
    }

    console.log(`Total Watch Later videos fetched: ${allVideos.length}`);
    return allVideos;
}

// Save videos to chrome.storage.local
async function saveWatchLaterVideos(videos) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(
            {
                watchLaterVideos: videos,
                lastSyncTimestamp: Date.now(),
                syncMethod: "innertube",
            },
            () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    console.log(`Saved ${videos.length} Watch Later videos to storage.`);
                    resolve();
                }
            }
        );
    });
}

// Check if sync is needed
async function needsSync() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["lastSyncTimestamp", "watchLaterVideos"], (data) => {
            const lastSync = data.lastSyncTimestamp || 0;
            const timeSinceLastSync = Date.now() - lastSync;
            resolve(timeSinceLastSync > CONFIG.SYNC_INTERVAL || !data.watchLaterVideos || data.watchLaterVideos.length === 0);
        });
    });
}

// Sync Watch Later videos in the background
async function syncWatchLaterVideos() {
    const videos = await fetchWatchLaterVideos();
    await saveWatchLaterVideos(videos);
    return videos;
}

// Disconnect previous observers to prevent memory leaks
function cleanupObservers() {
    if (window._ytWLNavObserver) {
        window._ytWLNavObserver.disconnect();
        window._ytWLNavObserver = null;
    }
    if (window._ytWLContentObserver) {
        window._ytWLContentObserver.disconnect();
        window._ytWLContentObserver = null;
    }
}

// Remove distractions (sidebar, header, recommendations, shorts)
function removeDistractions() {
    const styleId = "youtube-watch-later-hide-elements";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
            ytd-mini-guide-renderer, #guide, ytd-guide-renderer, #guide-content { display: none !important; }
            ytd-masthead, #masthead-container, #header, #header-container { display: none !important; }
            ytd-browse[page-subtype="home"] #content, #primary, ytd-app #content, ytd-browse {
                margin-left: 0 !important; margin-top: 0 !important;
                width: 100% !important; padding-top: 0 !important;
            }
            #top-level-buttons, #start, #end { display: none !important; }
            #frosted-glass { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    const hideNav = () => {
        for (const sel of [
            "ytd-masthead", "#masthead-container", "#header", "#header-container",
            "ytd-mini-guide-renderer", "#guide", "ytd-guide-renderer",
            "#guide-content", "#frosted-glass",
        ]) {
            const el = document.querySelector(sel);
            if (el) { el.style.display = "none"; el.style.visibility = "hidden"; }
        }
    };

    hideNav();

    const navObserver = new MutationObserver(hideNav);
    if (document.body) {
        navObserver.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ["style", "class"],
        });
    }
    window._ytWLNavObserver = navObserver;

    const distractionSelectors = [
        "ytd-rich-section-renderer", "ytd-shelf-renderer", "ytd-reel-shelf-renderer",
        "#related", "#dismissible", "ytd-mini-player",
        "ytd-browse[page-subtype='home'] ytd-rich-grid-renderer",
        "ytd-watch-next-secondary-results-renderer", "#secondary",
        "ytd-compact-video-renderer",
    ];

    for (const selector of distractionSelectors) {
        try {
            for (const el of document.querySelectorAll(selector)) {
                if (!el.closest("#custom-watch-later")) el.remove();
            }
        } catch {}
    }

    const contentObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                for (const selector of distractionSelectors) {
                    try {
                        if (node.matches?.(selector) && !node.closest("#custom-watch-later")) {
                            node.remove(); continue;
                        }
                        for (const child of node.querySelectorAll?.(selector) || []) {
                            if (!child.closest("#custom-watch-later")) child.remove();
                        }
                    } catch {}
                }
            }
        }
    });

    contentObserver.observe(document.body, { childList: true, subtree: true });
    window._ytWLContentObserver = contentObserver;
}

// Helper functions
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

function isValidYouTubeURL(url) {
    try {
        const parsed = new URL(url);
        return parsed.origin === "https://www.youtube.com" && parsed.pathname === "/watch";
    } catch { return false; }
}

// Sort and filter videos based on current UI state
function applySortAndFilter(videos) {
    let filtered = videos;

    // Search filter
    if (currentSearch) {
        const q = currentSearch.toLowerCase();
        filtered = filtered.filter(v =>
            v.title.toLowerCase().includes(q) ||
            (v.channel && v.channel.toLowerCase().includes(q))
        );
    }

    // Sort
    if (currentSort === "title") {
        filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    } else if (currentSort === "duration") {
        filtered = [...filtered].sort((a, b) => parseDuration(b.duration) - parseDuration(a.duration));
    } else if (currentSort === "channel") {
        filtered = [...filtered].sort((a, b) => (a.channel || "").localeCompare(b.channel || ""));
    }
    // "default" preserves the original Watch Later order (most recently added first)

    return filtered;
}

// Render just the video grid (called when sort/search changes without re-rendering header)
function renderVideoGrid(videos) {
    const container = document.getElementById("custom-watch-later");
    if (!container) return;

    const oldGrid = container.querySelector(".yt-wl-grid");
    if (oldGrid) oldGrid.remove();

    const oldCount = container.querySelector(".yt-wl-count");
    if (oldCount) oldCount.remove();

    const darkMode = isDarkMode();
    const textColor = darkMode ? "#ffffff" : "#030303";
    const secondaryTextColor = darkMode ? "#aaaaaa" : "#606060";

    const displayed = applySortAndFilter(videos);

    // Video count
    const countEl = document.createElement("div");
    countEl.className = "yt-wl-count";
    const totalLabel = displayed.length === videos.length
        ? `${videos.length} videos`
        : `${displayed.length} of ${videos.length} videos`;
    countEl.textContent = totalLabel;
    countEl.style.cssText = `
        color: ${secondaryTextColor}; font-size: 14px; margin-bottom: 16px;
        font-family: "YouTube Noto", Roboto, Arial, sans-serif;
    `;
    container.appendChild(countEl);

    if (displayed.length === 0) {
        const noResults = document.createElement("div");
        noResults.className = "yt-wl-grid";
        noResults.style.cssText = `text-align: center; padding: 40px; color: ${secondaryTextColor};`;
        noResults.textContent = currentSearch ? "No videos match your search." : "Your Watch Later is empty.";
        container.appendChild(noResults);
        return;
    }

    const videoGrid = document.createElement("div");
    videoGrid.className = "yt-wl-grid";
    videoGrid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px; width: 100%;
    `;

    for (const video of displayed) {
        const videoId = video.videoId || getYouTubeVideoID(video.url);
        const safeUrl = isValidYouTubeURL(video.url) ? video.url : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
        const thumbnail = video.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        const duration = video.duration
            ? `<span style="
                position: absolute; bottom: 8px; right: 8px;
                background: rgba(0,0,0,0.8); color: white;
                padding: 2px 6px; border-radius: 4px;
                font-size: 12px; font-weight: 500;
            ">${escapeHtml(video.duration)}</span>`
            : "";

        const channelLine = video.channel
            ? `<div style="color: ${secondaryTextColor}; font-size: 13px; margin-top: 2px;
                font-family: 'YouTube Noto', Roboto, Arial, sans-serif;">${escapeHtml(video.channel)}</div>`
            : "";

        const videoCard = document.createElement("div");
        videoCard.style.cssText = `
            background: transparent; border-radius: 12px;
            overflow: hidden; cursor: pointer; transition: transform 0.2s;
        `;
        videoCard.addEventListener("mouseenter", () => { videoCard.style.transform = "scale(1.02)"; });
        videoCard.addEventListener("mouseleave", () => { videoCard.style.transform = "scale(1)"; });

        videoCard.innerHTML = `
            <a href="${safeUrl}" style="text-decoration: none; color: inherit; display: block;">
                <div style="position: relative; width: 100%; padding-bottom: 56.25%; background: #000; border-radius: 12px; overflow: hidden;">
                    <img src="${thumbnail}"
                         style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;"
                         alt="${escapeHtml(video.title)}"
                         loading="lazy">
                    ${duration}
                </div>
                <div style="padding: 12px 0;">
                    <h3 style="
                        color: ${textColor}; font-size: 16px; font-weight: 500;
                        margin: 0; line-height: 22px;
                        display: -webkit-box; -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical; overflow: hidden;
                        font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
                    ">${escapeHtml(video.title)}</h3>
                    ${channelLine}
                </div>
            </a>
        `;

        videoGrid.appendChild(videoCard);
    }

    container.appendChild(videoGrid);
}

// Inject Watch Later UI into the homepage
function injectWatchLaterVideos(videos) {
    const existing = document.getElementById("custom-watch-later");
    if (existing) existing.remove();

    const homepage = document.querySelector("ytd-app");
    if (!homepage) return;

    const content = document.querySelector("#content");
    if (content) {
        for (const section of content.querySelectorAll("ytd-rich-section-renderer, ytd-shelf-renderer, ytd-rich-grid-renderer")) {
            section.style.display = "none";
        }
        content.style.marginLeft = "0";
        content.style.width = "100%";
    }

    const skeleton = document.querySelector("ytd-home-page-skeleton");
    if (skeleton) skeleton.style.display = "none";

    const darkMode = isDarkMode();
    const bgColor = darkMode ? "#0f0f0f" : "#f9f9f9";
    const cardBgColor = darkMode ? "#272727" : "#ffffff";
    const textColor = darkMode ? "#ffffff" : "#030303";
    const secondaryTextColor = darkMode ? "#aaaaaa" : "#606060";
    const borderColor = darkMode ? "#3f3f3f" : "#d3d3d3";

    const watchLaterSection = document.createElement("div");
    watchLaterSection.id = "custom-watch-later";
    watchLaterSection.style.cssText = `
        padding: 24px; background: ${bgColor}; min-height: 100vh;
        width: 100%; position: relative; z-index: 1000;
        margin: 0; box-sizing: border-box;
    `;

    // -- Header row: title + refresh --
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 16px; flex-wrap: wrap; gap: 16px;
    `;

    const title = document.createElement("h1");
    title.textContent = "Your Watch Later";
    title.style.cssText = `
        color: ${textColor}; font-size: 24px; font-weight: 400; margin: 0;
        font-family: "YouTube Noto", Roboto, Arial, sans-serif;
    `;

    const refreshContainer = document.createElement("div");
    refreshContainer.style.cssText = "display: flex; align-items: center; gap: 12px;";

    // Sync status
    chrome.storage.local.get(["lastSyncTimestamp"], (data) => {
        if (data.lastSyncTimestamp) {
            const syncStatus = document.createElement("span");
            syncStatus.id = "sync-status";
            syncStatus.textContent = `Last synced: ${getTimeAgo(new Date(data.lastSyncTimestamp))}`;
            syncStatus.style.cssText = `
                color: ${secondaryTextColor}; font-size: 14px;
                font-family: "YouTube Noto", Roboto, Arial, sans-serif;
            `;
            refreshContainer.insertBefore(syncStatus, refreshContainer.firstChild);
        }
    });

    // Refresh button
    const refreshButton = document.createElement("button");
    refreshButton.innerHTML = "\u{1F504}";
    refreshButton.title = "Refresh Watch Later list";
    refreshButton.style.cssText = `
        background: ${cardBgColor}; border: 1px solid ${borderColor};
        border-radius: 20px; width: 40px; height: 40px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; transition: all 0.2s;
    `;
    refreshButton.addEventListener("mouseenter", () => { refreshButton.style.opacity = "0.8"; refreshButton.style.transform = "scale(1.1)"; });
    refreshButton.addEventListener("mouseleave", () => { refreshButton.style.opacity = "1"; refreshButton.style.transform = "scale(1)"; });
    refreshButton.addEventListener("click", async () => {
        refreshButton.disabled = true;
        refreshButton.style.opacity = "0.5";
        refreshButton.innerHTML = "\u23F3";
        try {
            const fresh = await syncWatchLaterVideos();
            injectWatchLaterVideos(fresh);
        } catch {
            showError("Failed to sync Watch Later videos. Please try again.");
            refreshButton.disabled = false;
            refreshButton.style.opacity = "1";
            refreshButton.innerHTML = "\u{1F504}";
        }
    });

    refreshContainer.appendChild(refreshButton);
    header.appendChild(title);
    header.appendChild(refreshContainer);
    watchLaterSection.appendChild(header);

    // -- Toolbar row: search + sort --
    if (videos && videos.length > 0) {
        const toolbar = document.createElement("div");
        toolbar.style.cssText = `
            display: flex; align-items: center; gap: 12px;
            margin-bottom: 16px; flex-wrap: wrap;
        `;

        // Search input
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Search videos or channels...";
        searchInput.value = currentSearch;
        searchInput.style.cssText = `
            flex: 1; min-width: 200px; max-width: 400px;
            padding: 8px 14px; border-radius: 20px;
            border: 1px solid ${borderColor}; background: ${cardBgColor};
            color: ${textColor}; font-size: 14px; outline: none;
            font-family: "YouTube Noto", Roboto, Arial, sans-serif;
        `;
        searchInput.addEventListener("input", () => {
            currentSearch = searchInput.value;
            renderVideoGrid(videos);
        });

        // Sort dropdown
        const sortSelect = document.createElement("select");
        sortSelect.style.cssText = `
            padding: 8px 14px; border-radius: 20px;
            border: 1px solid ${borderColor}; background: ${cardBgColor};
            color: ${textColor}; font-size: 14px; outline: none; cursor: pointer;
            font-family: "YouTube Noto", Roboto, Arial, sans-serif;
            appearance: auto;
        `;
        const sortOptions = [
            { value: "default", label: "Date added" },
            { value: "title", label: "Title A\u2013Z" },
            { value: "duration", label: "Duration (longest)" },
            { value: "channel", label: "Channel A\u2013Z" },
        ];
        for (const opt of sortOptions) {
            const option = document.createElement("option");
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === currentSort) option.selected = true;
            sortSelect.appendChild(option);
        }
        sortSelect.addEventListener("change", () => {
            currentSort = sortSelect.value;
            renderVideoGrid(videos);
        });

        toolbar.appendChild(searchInput);
        toolbar.appendChild(sortSelect);
        watchLaterSection.appendChild(toolbar);
    }

    homepage.appendChild(watchLaterSection);

    // Render the grid (or empty state)
    renderVideoGrid(videos || []);
}

function showError(message) {
    const error = document.createElement("div");
    error.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: #ff3333; color: white;
        padding: 16px 24px; border-radius: 8px;
        z-index: 10000; font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    error.textContent = message;
    document.body.appendChild(error);
    setTimeout(() => error.remove(), 5000);
}

// Initialize based on current page
async function initialize() {
    const pathname = window.location.pathname;
    cleanupObservers();

    if (pathname === "/" || pathname === "" || pathname === "/feed") {
        removeDistractions();

        // Load cached videos immediately
        chrome.storage.local.get("watchLaterVideos", (data) => {
            injectWatchLaterVideos(data.watchLaterVideos || []);
        });

        // Background sync if stale
        const stale = await needsSync();
        if (stale) {
            try {
                const videos = await syncWatchLaterVideos();
                injectWatchLaterVideos(videos);
            } catch (err) {
                console.warn("Background sync failed:", err);
            }
        }
    }

    if (pathname.startsWith("/watch")) {
        removeDistractions();
    }
}

// Run initialization
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
} else {
    initialize();
}

// Re-initialize on SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(initialize, 500);
    }
}).observe(document, { subtree: true, childList: true });
