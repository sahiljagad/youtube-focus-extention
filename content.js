console.log("Content.js loaded!");

// Function to scrape Watch Later videos
async function scrapeWatchLaterVideos() {
    console.log("Scraping Watch Later videos");

    // Wait for video elements to load
    let videoLinks = await new Promise(resolve => {
        let checkExist = setInterval(() => {
            let videos = document.querySelectorAll("a#video-title");
            if (videos.length > 0) {
                clearInterval(checkExist);
                resolve(videos);
            }
        }, 500);
    });

    let videos = Array.from(videoLinks).map(anchor => ({
        title: anchor.title,
        url: anchor.href
    }));

    // Store videos in Chrome storage
    chrome.storage.local.set({ watchLaterVideos: videos }, () => {
        console.log("Watch Later videos saved to storage.");
    });
}

// Function to inject Watch Later videos into YouTube homepage
function injectVideosIntoHomepage(videos) {

    let homepage = document.querySelector("#content"); // YouTube's main content section
    if (!homepage) {
        console.warn("YouTube homepage not found.");
        return;
    }


    // Remove existing section if it already exists
    let existingSection = document.getElementById("custom-watch-later");
    if (existingSection) existingSection.remove();

    // Remove exisiting video grid
    homepage.innerHTML = "";

    // Create a new container for Watch Later videos
    let watchLaterSection = document.createElement("div");
    watchLaterSection.id = "custom-watch-later";
    watchLaterSection.style.padding = "20px";
    watchLaterSection.style.background = "#181818"; // Match YouTube's dark theme
    watchLaterSection.style.borderRadius = "10px";
    watchLaterSection.style.margin = "20px 0";
    watchLaterSection.innerHTML = `<h1 style="color: white;">Your Watch Later</h1><br>`;

    // Create a video grid
    let videoGrid = document.createElement("div");
    videoGrid.style.display = "grid";
    videoGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(200px, 1fr))";
    videoGrid.style.gap = "15px";

    // Add each video as a card
    videos.forEach(video => {
        let videoCard = document.createElement("div");
        videoCard.style.background = "#202020";
        videoCard.style.padding = "10px";
        videoCard.style.borderRadius = "8px";
        videoCard.style.textAlign = "center";

        videoCard.innerHTML = `
            <a href="${video.url}" target="_blank" style="text-decoration: none; color: white;">
                <img src="https://img.youtube.com/vi/${getYouTubeVideoID(video.url)}/mqdefault.jpg" 
                     style="width: 100%; border-radius: 5px;">
                <p style="margin-top: 8px; font-size: 14px;">${video.title}</p>
            </a>
        `;

        videoGrid.appendChild(videoCard);
    });

    watchLaterSection.appendChild(videoGrid);
    homepage.prepend(watchLaterSection); // Insert at the top of the homepage
}

// Helper function to extract YouTube video ID
function getYouTubeVideoID(url) {
    let match = url.match(/v=([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : "";
}

// Run the correct function based on the current page
if (window.location.pathname === "/playlist") {
    // If on Watch Later page, scrape videos
    scrapeWatchLaterVideos();
} else if (window.location.pathname === "/") {
    // If on the YouTube homepage, inject videos
    chrome.storage.local.get("watchLaterVideos", data => {
        if (data.watchLaterVideos && data.watchLaterVideos.length > 0) {
            injectVideosIntoHomepage(data.watchLaterVideos);
        } else {
            console.log("No Watch Later videos found in storage.");
        }
    });
}
