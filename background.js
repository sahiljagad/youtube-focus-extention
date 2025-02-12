chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.url.includes("youtube.com")) {
      chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          files: ["content.js"]
      });
  }
});
