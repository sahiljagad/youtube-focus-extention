// Authenticate the user and get their OAuth token
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("Token fetch failed"));
        return;
      }
      resolve(token);
    });
  });
}

// Fetch videos from the Watch Later playlist
async function fetchWatchLaterVideos() {
  try {
    const token = await getAuthToken();

    // Test the token
    console.log("OAuth Token:", token);

    const response = await fetch(
      "https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=25",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const data = await response.json();

    // Log full response for debugging
    console.log("API Response:", data);

    if (data.error) {
      console.error("YouTube API Error:", data.error);
      return [];
    }

    return data.items || [];
  } catch (error) {
    console.error("Failed to fetch Watch Later videos:", error);
    return [];
  }
}

// Listen for content script requests
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "fetchWatchLaterVideos") {
    const videos = await fetchWatchLaterVideos();
    sendResponse({ videos });
  }
  return true;
});