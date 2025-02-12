(function () {
    function scrapeVideos() {
        let videos = [];
        document.querySelectorAll("a#video-title").forEach(anchor => {
            videos.push({
                title: anchor.innerText.trim(),
                url: anchor.href
            });
        });

        console.log("Scraped videos:", videos);
        
        // Store the data in local storage or send it to a background script
        chrome.storage.local.set({ watchLaterVideos: videos }, () => {
            console.log("Videos saved to local storage.");
        });
    }

    // Run scraping after DOM loads
    if (document.readyState === "complete" || document.readyState === "interactive") {
        scrapeVideos();
    } else {
        window.addEventListener("load", scrapeVideos);
    }
})();
