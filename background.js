// Background service worker for FocusTube

console.log("FocusTube: Background script loaded");

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "syncWatchLater") {
        // Handle sync request if needed
        console.log("Sync request received");
        sendResponse({ success: true });
        return true; // Indicates we'll send a response asynchronously
    }
});