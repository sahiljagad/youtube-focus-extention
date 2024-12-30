// Request Watch Later videos from the background script
chrome.runtime.sendMessage({ action: "fetchWatchLaterVideos" }, (response) => {
  const { videos } = response;

  if (!videos || videos.length === 0) {
    console.error("No Watch Later videos found.");
    return;
  }

  // Clear the existing homepage content
  const homeFeed = document.querySelector("#contents");
  if (homeFeed) {
    homeFeed.innerHTML = "";

    // Inject Watch Later videos
    videos.forEach((video) => {
      const videoElement = document.createElement("div");
      videoElement.style.margin = "20px";
      videoElement.innerHTML = `
          <a href="https://www.youtube.com/watch?v=${video.snippet.resourceId.videoId}" target="_blank">
            <img src="${video.snippet.thumbnails.medium.url}" alt="${video.snippet.title}">
            <p>${video.snippet.title}</p>
          </a>
        `;
      homeFeed.appendChild(videoElement);
    });
  }
});
