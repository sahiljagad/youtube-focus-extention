console.log("Content.js loaded!");

// Function to scrape Watch Later videos from the Watch Later playlist
async function scrapeWatchLaterVideos() {
    console.log("Scraping Watch Later videos");

    // Wait for video elements to load on the Watch Later page
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

    // Store the videos and the hasScraped flag in Chrome storage
    chrome.storage.local.set({ 
        watchLaterVideos: videos,
        hasScraped: true 
    }, () => {
        console.log("Watch Later videos saved to storage.");
        // Once the videos are scraped, redirect the user back to the homepage
        window.location.href = "https://www.youtube.com/"; // Redirect to homepage
    });
}

// Function to remove distractions (suggested videos, shorts, etc.) on the homepage
function removeDistractions() {
    // Remove suggested videos and other elements that are distractions
    let suggestions = document.querySelectorAll("#related, #dismissible, ytd-mini-player");
    suggestions.forEach(suggestion => suggestion.remove());

    // Optionally, you can also hide other elements like the shorts section:
    let shortsSection = document.querySelector("#shorts");
    if (shortsSection) {
        shortsSection.remove();
    }

    console.log("Distractions removed.");
}

// Function to inject Watch Later videos into YouTube homepage
function injectWatchLaterVideos(videos) {
    // Find the container for the page content
    let homepage = document.querySelector("ytd-app"); // The parent container for the page content
    if (!homepage) {
        console.warn("YouTube homepage not found.");
        return;
    }

    // remove existing content
    let content = document.querySelector("#content");
    if (content) {
        content.innerHTML = "";
    }

    // Check if the home-page-skeleton is present and hide it to allow your content to show
    let skeleton = document.querySelector("ytd-home-page-skeleton");
    if (skeleton) {
        skeleton.style.display = "none"; // Hide the skeleton so it's not covering your content
    }

    // Create a new container for Watch Later videos
    let watchLaterSection = document.createElement("div");
    watchLaterSection.id = "custom-watch-later";
    watchLaterSection.style.padding = "20px";
    watchLaterSection.style.background = "#181818"; // Match YouTube's dark theme
    watchLaterSection.style.borderRadius = "10px";
    watchLaterSection.style.margin = "20px 0";
    watchLaterSection.style.position = "relative"; // Ensure it's positioned correctly
    watchLaterSection.style.zIndex = "9999"; // Make sure it's above other elements
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

    // Append the section to the homepage, outside of any hidden sections
    homepage.appendChild(watchLaterSection);
}


// Helper function to extract YouTube video ID from URL
function getYouTubeVideoID(url) {
    let match = url.match(/v=([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : "";
}

// Function to check if we are on the Watch Later page
function checkForWatchLaterPage() {
    chrome.storage.local.get("hasScraped", data => {
        if (data.hasScraped !== true && window.location.pathname === "/playlist") {
            scrapeWatchLaterVideos(); // If we are on the Watch Later page, start scraping
        }
    });
}

// Redirect user to the Watch Later playlist if they're on the homepage, but only if not scraped yet
function redirectToWatchLater() {
    chrome.storage.local.get("hasScraped", data => {
        if (data.hasScraped !== true && window.location.pathname === "/") {
            console.log("Redirecting to Watch Later playlist...");
            // Set flag to indicate that the user has been redirected
            chrome.storage.local.set({ hasScraped: false }, () => {
                window.location.href = "https://www.youtube.com/playlist?list=WL"; // Redirect to Watch Later playlist
            });
        }
    });
}

// Inject the removeDistractions function on the homepage
if (window.location.pathname === "/") {
    removeDistractions();

    // Get Watch Later videos from storage and inject them if available
    chrome.storage.local.get("watchLaterVideos", data => {
        if (data.watchLaterVideos && data.watchLaterVideos.length > 0) {
            injectWatchLaterVideos(data.watchLaterVideos); // Inject the videos into the homepage
        }
    });
}

if (window.location.pathname.startsWith("/watch")) {
    removeDistractions();
}
// Run the function to handle the redirection to Watch Later page
redirectToWatchLater();

// Run the function to check if we are on the Watch Later page
checkForWatchLaterPage();
