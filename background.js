chrome.runtime.onInstalled.addListener(() => {
  console.log("YouTube Watch Later Scraper Extension Installed");
});

// Listen for the page load event when the user visits YouTube
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log(tabId, changeInfo, tab.url);
  if (
    changeInfo.status === "complete" &&
    tab.active &&
    tab.url.includes("youtube")
  ) {
    console.log("Starting to execute script");
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: scrapeWatchLaterVideos,
      },
      (result) => {
        console.log(result);
        // Send scraped data (Watch Later videos) to content.js
        const videos = result.length > 0 ? result[0].result : [];
        chrome.tabs.sendMessage(tabId, {
          action: "displayWatchLaterVideos",
          videos,
        });
      }
    );
  }
});

// Function to scrape Watch Later videos from the DOM
function scrapeWatchLaterVideos() {
  const videos = [];

  // Select video elements from the Watch Later playlist (may need to adjust selectors)
  const videoElements = document.querySelectorAll(
    "ytd-playlist-video-renderer"
  );

  videoElements.forEach((videoElement) => {
    const titleElement = videoElement.querySelector("#video-title");
    const thumbnailElement = videoElement.querySelector("#img");
    const videoId = videoElement.getAttribute("href")?.split("v=")[1]; // Get video ID from the link

    if (titleElement && videoId) {
      const title = titleElement.textContent.trim();
      const thumbnailUrl = thumbnailElement ? thumbnailElement.src : "";

      videos.push({
        title,
        videoId,
        thumbnailUrl,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
  });
  return videos;
}
