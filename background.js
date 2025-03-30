// Maximum number of tabs to remember
const MAX_HISTORY = 20; 
const RECENT_TABS_KEY = 'recentTabs';

// Getter function for recent tabs
function getRecentTabs() {
  return chrome.storage.local.get(RECENT_TABS_KEY).then(result => result[RECENT_TABS_KEY] || []);
}

// Setter function for recent tabs
function setRecentTabs(tabs) {
  return chrome.storage.local.set({ [RECENT_TABS_KEY]: tabs });
}

// Function to push a tab to our recent tabs stack
function trackTab(tabId, windowId) {
  getRecentTabs().then(recentTabs => {
    // Don't track the same tab twice in a row
    if (recentTabs.length > 0 && recentTabs[0].tabId === tabId) {
      return;
    }
    
    // Add the current tab to the front of the array
    recentTabs.unshift({ tabId, windowId });
    
    // Keep array at maximum length
    if (recentTabs.length > MAX_HISTORY) {
      recentTabs = recentTabs.slice(0, MAX_HISTORY);
    }
    
    // Save updated tabs
    setRecentTabs(recentTabs);
  });
}

// Track when the active tab changes within the same window
chrome.tabs.onActivated.addListener((activeInfo) => {
  trackTab(activeInfo.tabId, activeInfo.windowId);
});

// Track when the user switches between windows
chrome.windows.onFocusChanged.addListener((windowId) => {
  // windowId will be chrome.windows.WINDOW_ID_NONE if the focus left Chrome
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    // Get the active tab in the newly focused window
    chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
      if (tabs && tabs.length > 0) {
        trackTab(tabs[0].id, windowId);
      }
    });
  }
});

// Handle when a tab is closed to remove it from our tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  getRecentTabs().then(recentTabs => {
    if (!recentTabs || recentTabs.length === 0) return;
    
    const updatedTabs = recentTabs.filter(tab => tab.tabId !== tabId);
    setRecentTabs(updatedTabs);
  });
});

// Listen for the keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === "switch-to-last-tab") {
    switchToLastTab();
  }
});

// Function to switch to the last tab
function switchToLastTab() {
  getRecentTabs().then(recentTabs => {
    // Check if we have at least two tabs in history
    if (recentTabs.length < 2) {
      console.log("No previous tab to switch to");
      return;
    }
    
    const previousTab = recentTabs[1];
    
    // Check if the tab still exists
    chrome.tabs.get(previousTab.tabId, (tab) => {
      if (chrome.runtime.lastError) {
        // Tab doesn't exist anymore, remove it and try again
        const updatedTabs = recentTabs.filter(tab => tab.tabId !== previousTab.tabId);
        setRecentTabs(updatedTabs).then(() => {
          // After saving, try again
          switchToLastTab();
        });
        return;
      }
      
      // Focus the window if needed
      chrome.windows.update(previousTab.windowId, { focused: true }, () => {
        // Then activate the tab
        chrome.tabs.update(previousTab.tabId, { active: true });
      });
    });
  });
} 