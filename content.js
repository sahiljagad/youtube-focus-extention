// Listen for messages from background.js containing the Watch Later videos
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "displayWatchLaterVideos") {
    const { videos } = message;

    // Get the homepage feed element
    const homeFeed = document.querySelector("#contents");
    console.log(homeFeed);
    if (homeFeed) {
      homeFeed.innerHTML = ""; // Clear current homepage content

      // Create a container to display Watch Later videos
      const watchLaterContainer = document.createElement("div");
      watchLaterContainer.innerHTML = "<h2>Your Watch Later Videos</h2>";

      // Loop through the Watch Later videos and display them
      videos.forEach((video) => {
        const videoElement = document.createElement("div");
        videoElement.classList.add("video");
        videoElement.innerHTML = `
            <a href="${video.url}" target="_blank">
              <img src="${video.thumbnailUrl}" alt="${video.title}" style="width: 120px; height: 90px;">
              <p>${video.title}</p>
            </a>
          `;
        watchLaterContainer.appendChild(videoElement);
      });

      // Append the new content to the homepage feed
      homeFeed.appendChild(watchLaterContainer);
    }
  }
});
