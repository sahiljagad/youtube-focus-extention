chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    // Redirect to the Watch Later playlist if it's not already on it
    const oldURL = tab.url;
    if (
      tab.url.includes("youtube.com") &&
      !tab.url.includes("playlist?list=WL")
    ) {
      chrome.tabs.update(tabId, {
        url: "https://www.youtube.com/playlist?list=WL",
      });
    } else {
      // If already on the Watch Later playlist, run the scraping function
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: scrapeWatchLaterVideos,
        },
        (result) => {
          if (chrome.runtime.lastError) {
            console.error("Error executing script:", chrome.runtime.lastError);
            return;
          }

          // Check the result and scrape videos
          const videos = (result && result[0] && result[0].result) || [];
          console.log(videos);

          // Send scraped data (Watch Later videos) to content.js
          chrome.tabs.sendMessage(tabId, {
            action: "displayWatchLaterVideos",
            videos,
          });
        }
      );
    }
    chrome.tabs.update(tabId, {
      url: oldURL,
    });
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
  console.log("VIDS", videos);
  return videos;
}
