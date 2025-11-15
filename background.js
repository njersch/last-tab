import SetQueue from './setQueue.js';
import KeyPressHandler from './KeyPressHandler.js';

// Maximum number of tabs to remember.
const MAX_HISTORY = 20; 

// Key for property storing IDs of recently visited tabs,
// ordered from most recent to least recent.
const RECENT_TABS_KEY = 'recentTabs';

// Key for property storing ID of last tab known to be active.
const LAST_ACTIVE_TAB_KEY = 'lastActiveTab';

// Threshold for stale tabs in minutes.
const STALE_TAB_THRESHOLD = 15;


// Getter function for recent tabs.
async function getRecentTabs() {
  const result = await chrome.storage.local.get(RECENT_TABS_KEY);
  const equals = (a, b) => a.tabId === b.tabId;
  return new SetQueue(result[RECENT_TABS_KEY], equals);
}


// Setter function for recent tabs.
async function setRecentTabs(tabs) {
  await chrome.storage.local.set({ [RECENT_TABS_KEY]: tabs.toArray() });
}


// Getter function for ID of last active tab.
async function getLastActiveTab() {
  const result = await chrome.storage.local.get(LAST_ACTIVE_TAB_KEY);
  return result[LAST_ACTIVE_TAB_KEY] || null;
}


// Setter function for ID of last active tab.
async function setLastActiveTab(tabId) {
  await chrome.storage.local.set({ [LAST_ACTIVE_TAB_KEY]: tabId });
}


// Handler for when the active tab changes.
async function onTabActivated(tabId) {

  const lastActiveTab = await getLastActiveTab();

  // Don't update the last active tab if it's the same as the current tab.
  // This prevents processing the same tab twice and processing a tab that was
  // made active programmatically by this extension.
  if (lastActiveTab === tabId) {
    return;
  }

  // Mark the current tab as last active and to prevent further processing.
  await setLastActiveTab(tabId);


  // Update history of recent tabs:
  // If the user switched to a new tab, add the previously active tab
  // to the front of the queue, and then the current tab in front of it.
  // This allows the user to switch back between the two tabs by pressing
  // the shortcut again.
  const recentTabs = await getRecentTabs();
  const lastActiveTabIndex = recentTabs.findIndex(tab => tab.tabId === lastActiveTab);
  if (lastActiveTabIndex >= 0) {
    recentTabs.addFirst(recentTabs.at(lastActiveTabIndex));
  }
  const tab = await chrome.tabs.get(tabId);
  recentTabs.addFirst({ tabId, windowId: tab.windowId });
  
  // Keep history at maximum length by removing the oldest tab if necessary.
  while (recentTabs.size() > MAX_HISTORY) {
    recentTabs.removeLast();
  }
  
  // Save updated history.
  await setRecentTabs(recentTabs);
}


// Handler for when a tab is closed.
async function onTabRemoved(tabId) {
  const recentTabs = await getRecentTabs();
  recentTabs.remove({ tabId });
  await setRecentTabs(recentTabs);
}


// Handle when a tab is closed to remove it from our tracking.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await onTabRemoved(tabId);
});


// Handle when the active tab changes to update our tracking.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await onTabActivated(activeInfo.tabId);
});


// Handle when the user switches between windows.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  
  // Ignore if the focus left Chrome, in which case windowId will
  // be chrome.windows.WINDOW_ID_NONE.
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  // Get the active tab in the newly focused window.
  const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
  if (tabs && tabs.length > 0) {
    await onTabActivated(tabs[0].id);
  }
});

// Listen for the keyboard shortcut.
const keyPressHandler = new KeyPressHandler(
  () => { switchToLastTab(false); },
  () => { switchToLastTab(true); }
);
chrome.commands.onCommand.addListener((command) => {
  if (command === 'switch-to-last-tab') {
    keyPressHandler.handleKeyPress();
  } else if (command === 'close-tabs-without-recent-activity') {
    closeTabsWithoutRecentActivity();
  }
});


async function switchToLastTab(doublePress) {
  
  const recentTabs = await getRecentTabs();
  const lastActiveTabId = await getLastActiveTab();
  const lastActiveTabIndex = recentTabs.findIndex(tab => tab.tabId === lastActiveTabId);

  // If the last active tab is not in the history, ignore the request.
  // This should never happen.
  if (lastActiveTabIndex < 0) {
    console.error('Last active tab not found in history. Ignoring request.');
    return;
  }

  // Check if any window is focused.
  const windows = await chrome.windows.getAll();
  const hasFocusedWindow = windows.some(window => window.focused);

  // If no window is focused, switch to the most recently active tab.
  // If it's a double press or the current tab is the most recent one in the history,
  // go back one tab in the history. Otherwise, go back to the front of the history.
  let newActiveTabIndex;
  if (!hasFocusedWindow) {
    newActiveTabIndex = lastActiveTabIndex;
  } else if (doublePress || lastActiveTabIndex === 0) {
    newActiveTabIndex = lastActiveTabIndex + 1;
  } else {
    newActiveTabIndex = 0;
  }

  // If the new index is greater than the number of tabs in history,
  // set it to the oldest tab in history.
  if (newActiveTabIndex >= recentTabs.size()) {
    newActiveTabIndex = recentTabs.size() - 1;
  }

  const newActiveTabId = recentTabs.at(newActiveTabIndex).tabId;
  const allTabs = await chrome.tabs.query({});
  const newActiveTab = allTabs.find(tab => tab.id === newActiveTabId);

  // If the target tab is not found, remove it from the history and try again.
  if (!newActiveTab) {
    console.error('Target tab not found. Removing from history and trying again.');
    recentTabs.remove({ tabId: newActiveTabId });
    await setRecentTabs(recentTabs);
    switchToLastTab(doublePress);
    return;
  }

  // If it's a single press and we're going forward in history,
  // move the last active tab to second position in the queue,
  // and then the new active tab in front of it.
  if (!doublePress && newActiveTabIndex === 0) {
    recentTabs.addFirst(recentTabs.at(lastActiveTabIndex));
    recentTabs.addFirst(recentTabs.at(newActiveTabIndex));
    await setRecentTabs(recentTabs);
  }

  // Switch to the target tab.
  await setLastActiveTab(newActiveTabId);
  await chrome.windows.update(newActiveTab.windowId, { focused: true });
  chrome.tabs.update(newActiveTabId, { active: true });
}


async function closeTabsWithoutRecentActivity() {

  const currentWindow = await chrome.windows.getCurrent();

  if (!currentWindow) {
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