// youtube base link
// const youtube = "https://www.youtube.com/";

// // Remove distractions only on youtube links
// chrome.action.onClicked.addListener(async (tab) => {
//   if (tab.url.startsWith(youtube)) {
//     await chrome.scripting.insertCSS({
//       files: ["focus-mode.css"],
//       target: { tabId: tab.id },
//     });
//   }
// });

// Authenticate the user and get their OAuth token
// async function getAuthToken() {
//   return new Promise((resolve, reject) => {
//     chrome.identity.getAuthToken({ interactive: true }, (token) => {
//       if (chrome.runtime.lastError || !token) {
//         reject(chrome.runtime.lastError || new Error("Token fetch failed"));
//         return;
//       }
//       resolve(token);
//     });
//   });
// }

// Fetch videos from the Watch Later playlist
// async function fetchWatchLaterVideos() {
//   try {
//     const token = await getAuthToken();

//     // Test the token
//     console.log("OAuth Token:", token);

//     const response = await fetch(
//       "https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=25",
//       {
//         headers: { Authorization: `Bearer ${token}` },
//       }
//     );

//     const data = await response.json();

//     // Log full response for debugging
//     console.log("API Response:", data);

//     if (data.error) {
//       console.error("YouTube API Error:", data.error);
//       return [];
//     }

//     return data.items || [];
//   } catch (error) {
//     console.error("Failed to fetch Watch Later videos:", error);
//     return [];
//   }
// }

function scrapeWatchLaterVideos() {
  const videos = [];

  // Select the list of video elements in the Watch Later playlist
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

  console.log(videos);
  return videos;
}

// Listen for content script requests
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "fetchWatchLaterVideos") {
    const videos = await fetchWatchLaterVideos();
    sendResponse({ videos });
  }
  return true;
});
