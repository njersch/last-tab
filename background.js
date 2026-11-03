import SetQueue from './SetQueue.js';
import KeyPressHandler from './KeyPressHandler.js';

// Maximum number of tabs to remember.
const MAX_HISTORY = 20; 

// Key for property storing IDs of recently visited tabs,
// ordered from most recent to least recent.
const RECENT_TABS_KEY = 'recentTabs';

// Key for property storing ID of last tab known to be active.
const LAST_ACTIVE_TAB_KEY = 'lastActiveTab';

// Threshold for stale tabs in minutes.
const STALE_TAB_THRESHOLD = 5;

// Key for property storing, per split view created by this extension,
// the previous position of the tab that was moved into it.
const SPLIT_VIEWS_KEY = 'splitViews';


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


// Getter function for previous positions of tabs moved into split views.
async function getSplitViews() {
  const result = await chrome.storage.local.get(SPLIT_VIEWS_KEY);
  return result[SPLIT_VIEWS_KEY] || {};
}


// Setter function for previous positions of tabs moved into split views.
// Drops entries of split views that no longer exist.
async function setSplitViews(splitViews) {
  const tabs = await chrome.tabs.query({});
  const splitViewIds = new Set(tabs.map(tab => tab.splitViewId));
  const existing = Object.entries(splitViews).filter(([id]) => splitViewIds.has(Number(id)));
  await chrome.storage.local.set({ [SPLIT_VIEWS_KEY]: Object.fromEntries(existing) });
}


// Returns the previous position of the tab moved into the given split view,
// or null if there is none or it belongs to tabs no longer in that split view.
async function getSplitViewRecord(splitViewId, tabIds) {
  const record = (await getSplitViews())[splitViewId];
  return record && tabIds.includes(record.tabId) ? record : null;
}


// Returns the other tab sharing a split view with the given tab,
// or null if the tab is not part of a split view.
async function getSplitViewSibling(tab) {
  if (tab.splitViewId == null || tab.splitViewId === chrome.tabs.SPLIT_VIEW_ID_NONE) {
    return null;
  }
  const tabsInSplit = await chrome.tabs.query({ splitViewId: tab.splitViewId });
  return tabsInSplit.find(t => t.id !== tab.id) || null;
}


// Handler for when the active tab changes.
async function onTabActivated(tabId) {

  // Ignore the tab if it was closed in the meantime.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    return;
  }

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
  recentTabs.addFirst({ tabId, windowId: tab.windowId });

  // Treat a split view as a single tab: keep only the active pane in history
  // so that switching never lands on the inactive pane of the current split view.
  const sibling = await getSplitViewSibling(tab);
  if (sibling) {
    recentTabs.remove({ tabId: sibling.id });
  }

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
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  // Ignore activations in unfocused windows. If the window gains focus later,
  // onFocusChanged records its active tab.
  const window = await chrome.windows.get(windowId);
  if (window.focused) {
    await onTabActivated(tabId);
  }
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
const lastTabKeyPressHandler = new KeyPressHandler(
  () => { switchToLastTab(false); },
  () => { switchToLastTab(true); }
);
const splitViewKeyPressHandler = new KeyPressHandler(toggleSplitView, swapSplitViewSides);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'switch-to-last-tab') {
    lastTabKeyPressHandler.handleKeyPress();
  } else if (command === 'close-tabs-without-recent-activity') {
    closeTabsWithoutRecentActivity();
  } else if (command === 'toggle-split-view') {
    splitViewKeyPressHandler.handleKeyPress(tab);
  }
});


// Determines which tab switching to the last tab would activate.
// Returns null if the request should be ignored.
async function findSwitchTarget(doublePress) {

  const recentTabs = await getRecentTabs();
  const lastActiveTabId = await getLastActiveTab();
  const lastActiveTabIndex = recentTabs.findIndex(tab => tab.tabId === lastActiveTabId);

  // If the last active tab is not in the history, ignore the request.
  // This should never happen.
  if (lastActiveTabIndex < 0) {
    console.error('Last active tab not found in history. Ignoring request.');
    return null;
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
    return findSwitchTarget(doublePress);
  }

  return { recentTabs, lastActiveTabIndex, newActiveTabIndex, newActiveTab };
}


async function switchToLastTab(doublePress) {

  const target = await findSwitchTarget(doublePress);
  if (!target) {
    return;
  }
  const { recentTabs, lastActiveTabIndex, newActiveTabIndex, newActiveTab } = target;
  const newActiveTabId = newActiveTab.id;

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

  // Switch to the target tab and focus the window.
  // Order is important because updating the window first would cause a random active tab
  // from the window to be added to the history.
  await chrome.tabs.update(newActiveTabId, { active: true });
  await chrome.windows.update(newActiveTab.windowId, { focused: true });
}


// Dissolves the split view containing the given tab. If the tab is not part of
// a split view, creates one with the tab on the left and the tab that switching
// to the last tab would activate on the right.
async function toggleSplitView(tab) {

  const sibling = await getSplitViewSibling(tab);
  if (sibling) {
    const record = await getSplitViewRecord(tab.splitViewId, [tab.id, sibling.id]);
    await chrome.tabs.unsplit(tab.splitViewId);
    if (record) {
      await restoreTabPosition(record);
    }

    // Restore the sibling in history, which only keeps the active pane of a
    // split view, so that switching goes to it and toggling again re-creates the split.
    const recentTabs = await getRecentTabs();
    recentTabs.addFirst({ tabId: sibling.id, windowId: sibling.windowId });
    recentTabs.addFirst({ tabId: tab.id, windowId: tab.windowId });
    await setRecentTabs(recentTabs);
    return;
  }

  const target = await findSwitchTarget(false);
  if (!target || target.newActiveTab.id === tab.id) {
    return;
  }
  const targetId = target.newActiveTab.id;

  // If the target was moved into its current split view, keep its original position.
  // Otherwise, move the other tab of that split view back to its previous position.
  let record = null;
  const targetSibling = await getSplitViewSibling(target.newActiveTab);
  if (targetSibling) {
    const oldRecord = await getSplitViewRecord(target.newActiveTab.splitViewId, [targetId, targetSibling.id]);
    await chrome.tabs.unsplit(target.newActiveTab.splitViewId);
    if (oldRecord?.tabId === targetId) {
      record = oldRecord;
    } else if (oldRecord) {
      await restoreTabPosition(oldRecord);
    }
  }

  // Remember the target's position to restore it when the split view is dissolved.
  const targetTab = await chrome.tabs.get(targetId);
  if (!record) {
    const tabsInWindow = await chrome.tabs.query({ windowId: targetTab.windowId });
    const i = tabsInWindow.findIndex(t => t.id === targetId);
    record = {
      tabId: targetId,
      windowId: targetTab.windowId,
      pinned: targetTab.pinned,
      groupId: targetTab.groupId,
      leftId: tabsInWindow[i - 1]?.id ?? null,
      rightId: tabsInWindow[i + 1]?.id ?? null,
    };
  }

  // Both tabs must share the same window, pinned state and group.
  if (targetTab.windowId !== tab.windowId) {
    await chrome.tabs.move(targetId, { windowId: tab.windowId, index: -1 });
  }
  if (targetTab.pinned !== tab.pinned) {
    await chrome.tabs.update(targetId, { pinned: tab.pinned });
  }
  if (targetTab.groupId !== tab.groupId) {
    if (tab.groupId < 0) {
      await chrome.tabs.ungroup(targetId);
    } else {
      await chrome.tabs.group({ groupId: tab.groupId, tabIds: targetId });
    }
  }

  // Both tabs must be adjacent. The steps above may have changed their indexes.
  await moveNextTo(targetId, await chrome.tabs.get(tab.id), 'right');

  const splitViewId = await chrome.tabs.createSplit([tab.id, targetId]);

  const splitViews = await getSplitViews();
  splitViews[splitViewId] = record;
  await setSplitViews(splitViews);

  // Keep only the active pane in history, as in onTabActivated.
  const recentTabs = await getRecentTabs();
  recentTabs.remove({ tabId: targetId });
  await setRecentTabs(recentTabs);
}


// Moves a tab directly to the right or left of the anchor tab in the same window.
// If the anchor is part of a split view, moves it next to the whole split view.
async function moveNextTo(tabId, anchor, side) {
  const tab = await chrome.tabs.get(tabId);
  const sibling = await getSplitViewSibling(anchor);
  const anchorIndex = sibling
    ? (side === 'right' ? Math.max : Math.min)(anchor.index, sibling.index)
    : anchor.index;
  const index = side === 'right'
    ? (tab.index < anchorIndex ? anchorIndex : anchorIndex + 1)
    : (tab.index < anchorIndex ? anchorIndex - 1 : anchorIndex);
  await chrome.tabs.move(tabId, { index });
}


// Moves a tab back to the position it had before it was moved into a split view,
// next to one of its previous neighbours. Leaves the tab where it is if neither
// neighbour is still in the previous window, or if the tab is active and would
// have to move to another window.
async function restoreTabPosition(record) {

  const tab = await chrome.tabs.get(record.tabId).catch(() => null);
  if (!tab || (tab.active && tab.windowId !== record.windowId)) {
    return;
  }

  const neighbours = await Promise.all(
    [record.leftId, record.rightId].map(id => id === null ? null : chrome.tabs.get(id).catch(() => null))
  );
  const i = neighbours.findIndex(n => n && n.id !== tab.id && n.windowId === record.windowId);
  if (i < 0) {
    return;
  }

  if (tab.windowId !== record.windowId) {
    await chrome.tabs.move(tab.id, { windowId: record.windowId, index: -1 });
  }
  if (tab.pinned !== record.pinned) {
    await chrome.tabs.update(tab.id, { pinned: record.pinned });
  }
  const group = record.groupId < 0 ? null : await chrome.tabGroups.get(record.groupId).catch(() => null);
  if (group && group.windowId === record.windowId) {
    await chrome.tabs.group({ groupId: group.id, tabIds: tab.id });
  } else if (tab.groupId >= 0) {
    await chrome.tabs.ungroup(tab.id);
  }

  // The steps above may have changed the neighbour's index.
  const neighbour = await chrome.tabs.get(neighbours[i].id);
  await moveNextTo(tab.id, neighbour, i === 0 ? 'right' : 'left');
}


// Switches the sides of the split view containing the given tab and keeps the
// tab active. Does nothing if the tab is not part of a split view.
async function swapSplitViewSides(tab) {

  const sibling = await getSplitViewSibling(tab);
  if (!sibling) {
    return;
  }

  const splitViews = await getSplitViews();
  const record = splitViews[tab.splitViewId];

  await chrome.tabs.unsplit(tab.splitViewId);

  // Moving the sibling to the tab's index swaps them from either side.
  await chrome.tabs.move(sibling.id, { index: tab.index });

  const splitViewId = await chrome.tabs.createSplit([tab.id, sibling.id]);
  await chrome.tabs.update(tab.id, { active: true });

  // Re-creating the split view changed its ID.
  if (record) {
    splitViews[splitViewId] = record;
    await setSplitViews(splitViews);
  }
}


async function closeTabsWithoutRecentActivity() {

  const currentWindow = await chrome.windows.getCurrent();

  if (!currentWindow) {
    return;
  }

  const tabsInWindow = await chrome.tabs.query({ windowId: currentWindow.id });
  const siblings = await Promise.all(tabsInWindow.map(getSplitViewSibling));

  const threshold = Date.now() - STALE_TAB_THRESHOLD * 60 * 1000;
  const isStale = (tab) => !tab.active && tab.lastAccessed < threshold;
  const staleTabs = tabsInWindow.filter((tab, i) => {
    const sibling = siblings[i];
    return (
      isStale(tab) &&
      !tab.pinned &&
      (!tab.groupId || tab.groupId < 0) &&
      (!sibling || sibling.lastAccessed < threshold)
    );
  });

  await chrome.tabs.remove(staleTabs.map((tab) => tab.id));

  // Collapse groups in which all tabs are stale.
  const groups = await chrome.tabGroups.query({ windowId: currentWindow.id, collapsed: false });
  const staleGroups = groups.filter((group) =>
    tabsInWindow.filter((tab) => tab.groupId === group.id).every(isStale)
  );
  await Promise.all(staleGroups.map((group) => chrome.tabGroups.update(group.id, { collapsed: true })));
}