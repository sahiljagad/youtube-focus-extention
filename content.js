console.log("YouTube Watch Later Enhancer: Content script loaded");

// Configuration
const CONFIG = {
    SYNC_INTERVAL: 5 * 60 * 1000, // 5 minutes in milliseconds
    SCRAPING_TIMEOUT: 10000, // 10 seconds
    CHECK_INTERVAL: 500, // 500ms for polling
};

// Helper function to extract YouTube video ID from URL
function getYouTubeVideoID(url) {
    if (!url) return "";
    let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})/);
    return match ? (match[1] || match[2]) : "";
}

// Helper function to detect if YouTube is in dark mode
function isDarkMode() {
    const htmlElement = document.documentElement;
    const computedStyle = window.getComputedStyle(htmlElement);
    const bgColor = computedStyle.backgroundColor;
    
    // Check if background is dark (RGB values are low)
    if (bgColor.startsWith('rgb')) {
        const rgb = bgColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const brightness = (parseInt(rgb[0]) + parseInt(rgb[1]) + parseInt(rgb[2])) / 3;
            return brightness < 128;
        }
    }
    
    // Fallback: check for dark theme class
    return htmlElement.hasAttribute('dark') || 
           htmlElement.classList.contains('dark') ||
           document.body.classList.contains('dark');
}

// Function to fetch Watch Later videos using YouTube's internal API
async function fetchWatchLaterFromAPI() {
    try {
        // Check if we can access YouTube's internal API data
        // YouTube stores playlist data in the initial response
        const response = await fetch('https://www.youtube.com/playlist?list=WL', {
            credentials: 'include'
        });
        
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Try to find initial data in script tags
        const scripts = doc.querySelectorAll('script');
        for (const script of scripts) {
            const content = script.textContent || script.innerHTML;
            if (content.includes('var ytInitialData')) {
                // Extract ytInitialData
                const match = content.match(/var ytInitialData\s*=\s*({.+?});/s);
                if (match) {
                    try {
                        const data = JSON.parse(match[1]);
                        // Navigate through YouTube's data structure to find playlist items
                        const playlistItems = extractPlaylistItemsFromData(data);
                        if (playlistItems && playlistItems.length > 0) {
                            return playlistItems;
                        }
                    } catch (e) {
                        console.warn("Failed to parse ytInitialData:", e);
                    }
                }
            }
        }
        
        // Fallback: if we're already on the Watch Later page, use current page data
        if (window.location.href.includes('list=WL') && window.ytInitialData) {
            const playlistItems = extractPlaylistItemsFromData(window.ytInitialData);
            if (playlistItems && playlistItems.length > 0) {
                return playlistItems;
            }
        }
        
        return null;
    } catch (error) {
        console.error("Error fetching Watch Later via API:", error);
        return null;
    }
}

// Helper function to extract playlist items from YouTube's data structure
function extractPlaylistItemsFromData(data) {
    try {
        const items = [];
        
        // Navigate through YouTube's nested structure
        const contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents ||
                        data?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.contents ||
                        [];
        
        for (const item of contents) {
            const videoRenderer = item?.playlistVideoRenderer || item?.playlistVideoListRenderer?.contents?.[0]?.playlistVideoRenderer;
            if (videoRenderer) {
                const videoId = videoRenderer.videoId;
                const title = videoRenderer.title?.runs?.[0]?.text || videoRenderer.title?.simpleText || "Unknown Title";
                const thumbnail = videoRenderer.thumbnail?.thumbnails?.[0]?.url || 
                                `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                
                items.push({
                    title: title,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    videoId: videoId,
                    thumbnail: thumbnail,
                    duration: videoRenderer.lengthText?.simpleText || videoRenderer.lengthText?.runs?.[0]?.text || null
                });
            }
        }
        
        return items.length > 0 ? items : null;
    } catch (error) {
        console.error("Error extracting playlist items:", error);
        return null;
    }
}

// Function to scroll and load all videos from playlist
async function scrollToLoadAllVideos(maxScrolls = 100) {
    console.log("Scrolling to load all videos...");
    
    let previousVideoCount = 0;
    let scrollAttempts = 0;
    const scrollDelay = 2500; // Wait 2.5 seconds between scroll attempts (increased for better loading)
    const maxStableCount = 4; // Number of consecutive same counts before stopping (increased)
    const scrollsPerAttempt = 4; // Scroll multiple times per attempt to be more aggressive
    
    const getVideoCount = () => {
        const selectors = [
            "ytd-playlist-video-renderer",
            "a#video-title",
            "a#video-title-link"
        ];
        
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                return elements.length;
            }
        }
        return 0;
    };
    
    // Helper function to scroll down
    const performScroll = () => {
        // Try multiple scroll methods for better compatibility
        const scrollHeight = document.documentElement.scrollHeight;
        const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
        const clientHeight = document.documentElement.clientHeight;
        
        // Scroll to bottom
        window.scrollTo(0, scrollHeight);
        
        // Also try scrolling the playlist container if it exists
        const playlistContainer = document.querySelector('ytd-playlist-video-list-renderer, #contents');
        if (playlistContainer) {
            playlistContainer.scrollTop = playlistContainer.scrollHeight;
        }
        
        // Small incremental scrolls to trigger lazy loading
        window.scrollBy(0, 500);
        setTimeout(() => window.scrollBy(0, 500), 200);
        setTimeout(() => window.scrollBy(0, 500), 400);
        setTimeout(() => window.scrollTo(0, scrollHeight), 600);
    };
    
    let stableCount = 0;
    
    // Wait for initial videos to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    while (scrollAttempts < maxScrolls) {
        // Get current video count
        const currentVideoCount = getVideoCount();
        
        console.log(`Scroll attempt ${scrollAttempts + 1}: Found ${currentVideoCount} videos (previous: ${previousVideoCount})`);
        
        // If count hasn't changed after multiple attempts, we're done
        if (currentVideoCount === previousVideoCount && currentVideoCount > 0) {
            stableCount++;
            if (stableCount >= maxStableCount) {
                console.log(`All videos loaded. Total: ${currentVideoCount}`);
                break;
            }
        } else {
            stableCount = 0; // Reset if count changed
        }
        
        previousVideoCount = currentVideoCount;
        
        // Perform multiple scrolls per attempt
        for (let i = 0; i < scrollsPerAttempt; i++) {
            performScroll();
            // Small delay between individual scrolls
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Wait for new content to load after scrolling
        await new Promise(resolve => setTimeout(resolve, scrollDelay));
        
        scrollAttempts++;
    }
    
    // Final scroll to ensure everything is loaded
    performScroll();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const finalCount = getVideoCount();
    console.log(`Finished scrolling after ${scrollAttempts} attempts. Final video count: ${finalCount}`);
    
    return finalCount;
}

// Improved function to scrape Watch Later videos from DOM (fallback)
async function scrapeWatchLaterVideos() {
    console.log("Scraping Watch Later videos from DOM (fallback method)");
    
    try {
        // First, scroll to load all videos
        await scrollToLoadAllVideos();
        
        // Wait a bit more for any final videos to render
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Multiple selector options for better compatibility
        const selectors = [
            "a#video-title",
            "a#video-title-link",
            "ytd-playlist-video-renderer a#video-title",
            "ytd-playlist-video-list-renderer a#video-title",
            "ytd-playlist-video-renderer a[href*='/watch?v=']"
        ];
        
        // Wait for video elements with timeout
        const videoLinks = await new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = CONFIG.SCRAPING_TIMEOUT / CONFIG.CHECK_INTERVAL;
            
            const checkExist = setInterval(() => {
                attempts++;
                
                // Try each selector
                for (const selector of selectors) {
                    const videos = document.querySelectorAll(selector);
            if (videos.length > 0) {
                clearInterval(checkExist);
                        resolve(Array.from(videos));
                        return;
                    }
                }
                
                // Timeout check
                if (attempts >= maxAttempts) {
                    clearInterval(checkExist);
                    reject(new Error("Timeout: Could not find video elements"));
                }
            }, CONFIG.CHECK_INTERVAL);
        });
        
        console.log(`Found ${videoLinks.length} video links, extracting data...`);
        
        // Extract video information
        const videos = [];
        const seenUrls = new Set();
        
        for (const anchor of videoLinks) {
            const url = anchor.href || anchor.getAttribute('href');
            if (!url || !url.includes('/watch?v=')) continue;
            
            const videoId = getYouTubeVideoID(url);
            if (!videoId || seenUrls.has(videoId)) continue;
            seenUrls.add(videoId);
            
            const title = anchor.title || 
                         anchor.textContent?.trim() || 
                         anchor.getAttribute('aria-label') || 
                         anchor.querySelector('#video-title')?.textContent?.trim() ||
                         "Unknown Title";
            
            // Try to find thumbnail from the video renderer
            const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
            
            videos.push({
                title: title,
                url: url.split('&')[0], // Clean URL
                videoId: videoId,
                thumbnail: thumbnail
            });
        }
        
        console.log(`Extracted ${videos.length} unique videos`);
        
        if (videos.length === 0) {
            throw new Error("No videos found in Watch Later playlist");
        }
        
        return videos;
    } catch (error) {
        console.error("Error scraping Watch Later videos:", error);
        throw error;
    }
}

// Main function to fetch Watch Later videos (tries API first, then scraping)
async function fetchWatchLaterVideos() {
    console.log("Fetching Watch Later videos...");
    
    // Try API method first
    let videos = await fetchWatchLaterFromAPI();
    
    // Fallback to DOM scraping if API method failed
    if (!videos || videos.length === 0) {
        console.log("API method failed, trying DOM scraping...");
        videos = await scrapeWatchLaterVideos();
    }
    
    return videos;
}

// Function to save videos to storage with metadata
async function saveWatchLaterVideos(videos) {
    return new Promise((resolve, reject) => {
        const syncData = {
            watchLaterVideos: videos,
            lastSyncTimestamp: Date.now(),
            hasScraped: true,
            syncMethod: 'auto'
        };
        
        chrome.storage.local.set(syncData, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                console.log(`Saved ${videos.length} Watch Later videos to storage.`);
                resolve();
            }
        });
    });
}

// Function to check if sync is needed
async function needsSync() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['lastSyncTimestamp', 'watchLaterVideos'], (data) => {
            const lastSync = data.lastSyncTimestamp || 0;
            const timeSinceLastSync = Date.now() - lastSync;
            const needsUpdate = timeSinceLastSync > CONFIG.SYNC_INTERVAL || !data.watchLaterVideos || data.watchLaterVideos.length === 0;
            resolve(needsUpdate);
        });
    });
}

// Function to sync Watch Later videos
async function syncWatchLaterVideos(showLoading = false) {
    try {
        // Only sync if we're on the Watch Later page
        if (!window.location.href.includes('list=WL')) {
            console.log("Not on Watch Later page, skipping sync");
            return false;
        }
        
        if (showLoading) {
            showLoadingState();
        }
        
        const videos = await fetchWatchLaterVideos();
        await saveWatchLaterVideos(videos);
        
        if (showLoading) {
            hideLoadingState();
        }
        
        // If we're on the Watch Later page and sync was successful, 
        // optionally redirect to homepage (but don't force it)
        if (window.location.href.includes('list=WL') && videos.length > 0) {
            // Only auto-redirect if user hasn't seen the homepage yet today
            const shouldRedirect = await shouldAutoRedirect();
            if (shouldRedirect) {
                console.log("Auto-redirecting to homepage...");
                window.location.href = "https://www.youtube.com/";
            }
        }
        
        return true;
    } catch (error) {
        console.error("Error syncing Watch Later videos:", error);
        if (showLoading) {
            hideLoadingState();
            showError("Failed to sync Watch Later videos. Please try again.");
        }
        return false;
    }
}

// Check if we should auto-redirect (only once per day)
async function shouldAutoRedirect() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['lastRedirectDate'], (data) => {
            const today = new Date().toDateString();
            const lastRedirect = data.lastRedirectDate || '';
            
            if (lastRedirect !== today) {
                chrome.storage.local.set({ lastRedirectDate: today }, () => {
                    resolve(true);
                });
            } else {
                resolve(false);
            }
        });
    });
}

// Enhanced function to remove distractions with MutationObserver
function removeDistractions() {
    // Inject CSS to hide sidebars, navigation, and search (most reliable method)
    const styleId = 'youtube-watch-later-hide-elements';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* Hide sidebar */
            ytd-mini-guide-renderer,
            #guide,
            ytd-guide-renderer,
            #guide-content {
                display: none !important;
            }
            
            /* Hide header/navigation bar with search */
            ytd-masthead,
            #masthead-container,
            #header,
            #header-container,
            ytd-browse #masthead-container {
                display: none !important;
            }
            
            /* Adjust content to full width */
            ytd-browse[page-subtype="home"] #content,
            #primary,
            ytd-app #content,
            ytd-browse {
                margin-left: 0 !important;
                margin-top: 0 !important;
                width: 100% !important;
                padding-top: 0 !important;
            }
            
            /* Hide other navigation elements */
            #top-level-buttons,
            #start,
            #end {
                display: none !important;
            }
            
            /* Hide frosted glass element */
            #frosted-glass {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Function to hide navigation/header elements directly
    const hideNavigationElements = () => {
        const elements = [
            document.querySelector('ytd-masthead'),
            document.querySelector('#masthead-container'),
            document.querySelector('#header'),
            document.querySelector('#header-container'),
            document.querySelector('ytd-mini-guide-renderer'),
            document.querySelector('#guide, ytd-guide-renderer'),
            document.querySelector('#guide-content'),
            document.querySelector('#frosted-glass'),
        ];
        
        elements.forEach(el => {
            if (el) {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
            }
        });
    };
    
    // Hide immediately
    hideNavigationElements();
    
    // Use MutationObserver to catch navigation elements when they appear
    const navObserver = new MutationObserver(() => {
        hideNavigationElements();
    });
    
    if (document.body) {
        navObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }
    
    // Store observer
    window.navObserver = navObserver;
    
    const selectors = [
        // Sidebar navigation (backup - CSS handles it primarily)
        "ytd-mini-guide-renderer",
        "#guide",
        "ytd-guide-renderer",
        "#guide-content",
        
        // Header/navigation
        "ytd-masthead",
        "#masthead-container",
        "#header",
        "#header-container",
        
        // Homepage distractions
        "ytd-rich-section-renderer",
        "ytd-shelf-renderer",
        "ytd-reel-shelf-renderer", // Shorts
        "#related",
        "#dismissible",
        "ytd-mini-player",
        "ytd-browse[page-subtype='home'] ytd-rich-grid-renderer", // Rich grid (videos feed)
        
        // Watch page distractions
        "ytd-watch-next-secondary-results-renderer",
        "#secondary",
        
        // Sidebar suggestions
        "ytd-compact-video-renderer",
        
        // But keep the Watch Later section visible
        ":not(#custom-watch-later) > ytd-item-section-renderer",
    ];
    
    // Remove existing distractions
    selectors.forEach(selector => {
        try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                // Don't remove our custom Watch Later section
                if (!el.closest('#custom-watch-later')) {
                    el.remove();
                }
            });
        } catch (e) {
            // Invalid selector, skip
        }
    });
    
    // Use MutationObserver to remove dynamically loaded distractions
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Element node
                    // Check for navigation/sidebar elements first
                    if (node.matches && (
                        node.matches('ytd-masthead') ||
                        node.matches('#masthead-container') ||
                        node.matches('ytd-mini-guide-renderer') ||
                        node.matches('#guide') ||
                        node.matches('ytd-guide-renderer') ||
                        node.matches('#guide-content') ||
                        node.matches('#frosted-glass')
                    )) {
                        node.style.display = 'none';
                        node.style.visibility = 'hidden';
                    }
                    
                    selectors.forEach(selector => {
                        try {
                            if (node.matches && node.matches(selector)) {
                                if (!node.closest('#custom-watch-later')) {
                                    node.remove();
                                }
                            }
                            // Also check children
                            const matches = node.querySelectorAll?.(selector);
                            if (matches) {
                                matches.forEach(el => {
                                    if (!el.closest('#custom-watch-later')) {
                                        el.remove();
                                    }
                                });
                            }
                        } catch (e) {
                            // Invalid selector, skip
                        }
                    });
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Store observer so we can disconnect it later if needed
    window.watchLaterObserver = observer;
    
    console.log("Distractions removed and observer active.");
}

// Enhanced UI injection with theme detection and better styling
function injectWatchLaterVideos(videos) {
    // Remove existing Watch Later section if it exists
    const existing = document.getElementById("custom-watch-later");
    if (existing) {
        existing.remove();
    }
    
    // Find the container for the page content
    const homepage = document.querySelector("ytd-app");
    if (!homepage) {
        console.warn("YouTube homepage not found.");
        return;
    }

    // Hide existing content sections (but not navigation)
    const content = document.querySelector("#content");
    if (content) {
        // Hide distracting sections
        const sections = content.querySelectorAll("ytd-rich-section-renderer, ytd-shelf-renderer, ytd-rich-grid-renderer");
        sections.forEach(section => section.style.display = "none");
        // Make content full width
        content.style.marginLeft = "0";
        content.style.width = "100%";
    }
    
    // Hide skeleton loader
    const skeleton = document.querySelector("ytd-home-page-skeleton");
    if (skeleton) {
        skeleton.style.display = "none";
    }
    
    // Ensure the app container uses full width
    if (homepage) {
        homepage.style.marginLeft = "0";
    }
    
    // Detect theme
    const darkMode = isDarkMode();
    const bgColor = darkMode ? "#0f0f0f" : "#f9f9f9";
    const cardBgColor = darkMode ? "#272727" : "#ffffff";
    const textColor = darkMode ? "#ffffff" : "#030303";
    const secondaryTextColor = darkMode ? "#aaaaaa" : "#606060";
    
    // Create main container (full width since sidebar is hidden)
    const watchLaterSection = document.createElement("div");
    watchLaterSection.id = "custom-watch-later";
    watchLaterSection.style.cssText = `
        padding: 24px;
        background: ${bgColor};
        min-height: 100vh;
        width: 100%;
        position: relative;
        z-index: 1000;
        margin: 0;
        box-sizing: border-box;
    `;
    
    // Create header with title and refresh button
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
        flex-wrap: wrap;
        gap: 16px;
    `;
    
    const title = document.createElement("h1");
    title.textContent = "Your Watch Later";
    title.style.cssText = `
        color: ${textColor};
        font-size: 24px;
        font-weight: 400;
        margin: 0;
        font-family: "YouTube Noto", Roboto, Arial, sans-serif;
    `;
    
    // Create refresh button container
    const refreshContainer = document.createElement("div");
    refreshContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
    `;
    
    // Last sync time
    chrome.storage.local.get(['lastSyncTimestamp'], (data) => {
        if (data.lastSyncTimestamp) {
            const syncTime = new Date(data.lastSyncTimestamp);
            const timeAgo = getTimeAgo(syncTime);
            const syncStatus = document.createElement("span");
            syncStatus.id = "sync-status";
            syncStatus.textContent = `Last synced: ${timeAgo}`;
            syncStatus.style.cssText = `
                color: ${secondaryTextColor};
                font-size: 14px;
                font-family: "YouTube Noto", Roboto, Arial, sans-serif;
            `;
            refreshContainer.appendChild(syncStatus);
        }
    });
    
    // Refresh button
    const refreshButton = document.createElement("button");
    refreshButton.id = "refresh-watch-later";
    refreshButton.innerHTML = "🔄";
    refreshButton.title = "Refresh Watch Later list";
    refreshButton.style.cssText = `
        background: ${cardBgColor};
        border: 1px solid ${darkMode ? "#3f3f3f" : "#d3d3d3"};
        border-radius: 20px;
        width: 40px;
        height: 40px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        transition: all 0.2s;
    `;
    
    refreshButton.addEventListener("mouseenter", () => {
        refreshButton.style.opacity = "0.8";
        refreshButton.style.transform = "scale(1.1)";
    });
    
    refreshButton.addEventListener("mouseleave", () => {
        refreshButton.style.opacity = "1";
        refreshButton.style.transform = "scale(1)";
    });
    
    refreshButton.addEventListener("click", async () => {
        refreshButton.disabled = true;
        refreshButton.style.opacity = "0.5";
        refreshButton.innerHTML = "⏳";
        
        // Navigate to Watch Later page to sync
        window.location.href = "https://www.youtube.com/playlist?list=WL";
    });
    
    refreshContainer.appendChild(refreshButton);
    
    header.appendChild(title);
    header.appendChild(refreshContainer);
    
    // Empty state
    if (!videos || videos.length === 0) {
        const emptyState = document.createElement("div");
        emptyState.style.cssText = `
            text-align: center;
            padding: 60px 20px;
            color: ${secondaryTextColor};
        `;
        emptyState.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 16px;">📺</div>
            <h2 style="color: ${textColor}; margin-bottom: 8px;">Your Watch Later is empty</h2>
            <p>Add videos to your Watch Later playlist to see them here.</p>
        `;
        watchLaterSection.appendChild(header);
        watchLaterSection.appendChild(emptyState);
        homepage.appendChild(watchLaterSection);
        return;
    }
    
    // Create video grid matching YouTube's layout
    const videoGrid = document.createElement("div");
    videoGrid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
        width: 100%;
    `;

    // Add each video as a card
    videos.forEach((video) => {
        const videoCard = document.createElement("div");
        videoCard.style.cssText = `
            background: transparent;
            border-radius: 12px;
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.2s;
        `;
        
        videoCard.addEventListener("mouseenter", () => {
            videoCard.style.transform = "scale(1.02)";
        });
        
        videoCard.addEventListener("mouseleave", () => {
            videoCard.style.transform = "scale(1)";
        });
        
        const videoId = video.videoId || getYouTubeVideoID(video.url);
        const thumbnail = video.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        const duration = video.duration ? `<span style="
            position: absolute;
            bottom: 8px;
            right: 8px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
        ">${video.duration}</span>` : '';

        videoCard.innerHTML = `
            <a href="${video.url}" style="text-decoration: none; color: inherit; display: block;">
                <div style="position: relative; width: 100%; padding-bottom: 56.25%; background: #000; border-radius: 12px; overflow: hidden;">
                    <img src="${thumbnail}" 
                         style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;"
                         alt="${video.title}"
                         loading="lazy">
                    ${duration}
                </div>
                <div style="padding: 12px 0;">
                    <h3 style="
                        color: ${textColor};
                        font-size: 16px;
                        font-weight: 500;
                        margin: 0 0 4px 0;
                        line-height: 22px;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                        font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
                    ">${escapeHtml(video.title)}</h3>
                </div>
            </a>
        `;

        videoGrid.appendChild(videoCard);
    });

    watchLaterSection.appendChild(header);
    watchLaterSection.appendChild(videoGrid);
    homepage.appendChild(watchLaterSection);
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to get time ago string
function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date) / 1000);
    
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

// Loading state functions
function showLoadingState() {
    const loading = document.createElement("div");
    loading.id = "watch-later-loading";
    loading.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 20px 40px;
        border-radius: 8px;
        z-index: 10000;
        font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
    `;
    loading.textContent = "Syncing Watch Later...";
    document.body.appendChild(loading);
}

function hideLoadingState() {
    const loading = document.getElementById("watch-later-loading");
    if (loading) {
        loading.remove();
    }
}

function showError(message) {
    const error = document.createElement("div");
    error.id = "watch-later-error";
    error.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff3333;
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        z-index: 10000;
        font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    error.textContent = message;
    document.body.appendChild(error);
    
    setTimeout(() => {
        error.remove();
    }, 5000);
}

// Initialize extension based on current page
async function initialize() {
    const pathname = window.location.pathname;
    const url = window.location.href;
    
    // Homepage logic
    if (pathname === "/" || pathname === "" || (pathname === "/feed" && !url.includes("/playlist"))) {
        console.log("On YouTube homepage, initializing...");
        
        // Remove distractions
        removeDistractions();
        
        // Check if we need to sync
        const needsUpdate = await needsSync();
        
        if (needsUpdate) {
            console.log("Watch Later needs sync, but we're on homepage. Loading cached data.");
        }
        
        // Get Watch Later videos from storage and display them
        chrome.storage.local.get("watchLaterVideos", async (data) => {
            if (data.watchLaterVideos && data.watchLaterVideos.length > 0) {
                injectWatchLaterVideos(data.watchLaterVideos);
            } else {
                // No cached data, show empty state with message to visit Watch Later
                injectWatchLaterVideos([]);
                
                // Show a helpful message
                setTimeout(() => {
                    const message = document.createElement("div");
                    message.style.cssText = `
                        background: ${isDarkMode() ? "#272727" : "#ffffff"};
                        color: ${isDarkMode() ? "#ffffff" : "#030303"};
                        padding: 16px;
                        border-radius: 8px;
                        margin: 20px 24px;
                        font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
                        text-align: center;
                    `;
                    message.innerHTML = `
                        <p>No Watch Later videos found. Click the refresh button above or 
                        <a href="https://www.youtube.com/playlist?list=WL" style="color: #3ea6ff; text-decoration: none;">visit your Watch Later playlist</a> 
                        to sync your videos.</p>
                    `;
                    const section = document.getElementById("custom-watch-later");
                    if (section) {
                        section.appendChild(message);
                    }
                }, 100);
        }
    });
}

    // Watch Later playlist page logic
    if (url.includes("list=WL")) {
        console.log("On Watch Later playlist page");
        
        // Check if we need to sync
        const needsUpdate = await needsSync();
        
        if (needsUpdate) {
            console.log("Syncing Watch Later videos...");
            await syncWatchLaterVideos(true);
        } else {
            console.log("Watch Later is up to date");
        }
    }
    
    // Watch page - remove distractions
    if (pathname.startsWith("/watch")) {
    removeDistractions();
}
}

// Run initialization when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
} else {
    initialize();
}

// Re-initialize on navigation (YouTube uses SPA navigation)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(initialize, 500); // Small delay for page to settle
    }
}).observe(document, { subtree: true, childList: true });
