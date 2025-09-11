// Maximum number of tabs to remember.
const MAX_HISTORY = 20; 

// Key for property storing IDs of recently visited tabs,
// ordered from most recent to least recent.
const RECENT_TABS_KEY = 'recentTabs';

// Threshold for stale tabs in minutes.
const STALE_TAB_THRESHOLD = 15;

// Getter function for recent tabs.
function getRecentTabs() {
  return chrome.storage.local.get(RECENT_TABS_KEY).then(result => result[RECENT_TABS_KEY] || []);
}

// Setter function for recent tabs.
function setRecentTabs(tabs) {
  return chrome.storage.local.set({ [RECENT_TABS_KEY]: tabs });
}

// Function to push a tab to our recent tabs stack.
async function trackTab(tabId, windowId) {

  let recentTabs = await getRecentTabs();

  // Don't track the same tab twice in a row.
  if (recentTabs.length > 0 && recentTabs[0].tabId === tabId) {
    return;
  }
  
  // Add the current tab to the front of the array.
  recentTabs.unshift({ tabId, windowId });
  
  // Keep array at maximum length.
  if (recentTabs.length > MAX_HISTORY) {
    recentTabs = recentTabs.slice(0, MAX_HISTORY);
  }
  
  // Save updated tabs.
  setRecentTabs(recentTabs);
}

// Track when the active tab changes within the same window.
chrome.tabs.onActivated.addListener((activeInfo) => {
  trackTab(activeInfo.tabId, activeInfo.windowId);
});

// Track when the user switches between windows.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  // windowId will be chrome.windows.WINDOW_ID_NONE if the focus left Chrome.
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    // Get the active tab in the newly focused window.
    const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
    if (tabs && tabs.length > 0) {
      await trackTab(tabs[0].id, windowId);
    }
  }
});

// Handle when a tab is closed to remove it from our tracking.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const recentTabs = await getRecentTabs();
  if (!recentTabs || recentTabs.length === 0) return;
  
  const updatedTabs = recentTabs.filter(tab => tab.tabId !== tabId);
  await setRecentTabs(updatedTabs);
});

// Listen for the keyboard shortcut.
chrome.commands.onCommand.addListener((command) => {
  if (command === "switch-to-last-tab") {
    switchToLastTab();
  } else if (command === "close-tabs-without-recent-activity") {
    closeTabsWithoutRecentActivity();
  }
});

// Function to switch to the last tab.
async function switchToLastTab() {

  // Check if any window is focused.
  const windows = await chrome.windows.getAll();
  const hasFocusedWindow = windows.some(window => window.focused);

  // If a window is focused, we want to switch to the tab before the focused tab.
  // If no window is focused, we want to switch to the most recently focused tab.
  const desiredTabIndex = hasFocusedWindow ? 1 : 0;

  const recentTabs = await getRecentTabs();
  
  // Check if we have enough tabs in history.
  if (recentTabs.length < desiredTabIndex + 1) {
    console.log("No previous tab to switch to");
    return;
  }
  
  const previousTab = recentTabs[desiredTabIndex];
  
  // Check if the tab still exists.
  // If not, remove it from recent tabs and try again.
  try {
    await chrome.tabs.get(previousTab.tabId);
  } catch (error) {
    console.log("Tab doesn't exist anymore, remove it and try again");
    const updatedTabs = recentTabs.filter(tab => tab.tabId !== previousTab.tabId);
    await setRecentTabs(updatedTabs);
    switchToLastTab();
    return;
  }
    
  // Focus the window if needed, and activate the tab.
  await chrome.windows.update(previousTab.windowId, { focused: true });
  await chrome.tabs.update(previousTab.tabId, { active: true });
}

// Function to close tabs without recent activity.
async function closeTabsWithoutRecentActivity() {

  const currentWindow = await chrome.windows.getCurrent();

  if (!currentWindow) {
    console.log("No window is focused");
    return;
  }

  const tabsInWindow = await chrome.tabs.query({ windowId: currentWindow.id });

  const now = Date.now();
  const staleTabs = tabsInWindow.filter(
    (tab) =>
      !tab.active &&
      !tab.pinned &&
      (!tab.groupId || tab.groupId < 0) &&
      tab.lastAccessed + (STALE_TAB_THRESHOLD * 60 * 1000) < now
  );

  await chrome.tabs.remove(staleTabs.map((tab) => tab.id));
}