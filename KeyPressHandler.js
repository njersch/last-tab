const DOUBLE_PRESS_THRESHOLD = 300;

// Keyboard shortcut handler that can distinguish between single and double presses
export default class KeyPressHandler {
  constructor(singlePressAction, doublePressAction) {
    this.singlePressAction = singlePressAction;
    this.doublePressAction = doublePressAction;
    this.lastPressTime = null;
    this.singlePressTimer = null
  }

  // Handle a key press for a specific command
  handleKeyPress() {

    const now = Date.now();
    
    // Clear any existing single press timer.
    if (this.singlePressTimer) {
      clearTimeout(this.singlePressTimer);
      this.singlePressTimer = null;
    }

    // Check if this is a double press.
    const isDoublePress =
      this.lastPressTime &&
      now - this.lastPressTime < DOUBLE_PRESS_THRESHOLD;
    
    if (isDoublePress) {
      this.lastPressTime = null;
      this.doublePressAction();
    } else {
      // This might be a single press, but wait to see if there's a second press
      this.lastPressTime = now;
      
      this.singlePressTimer = setTimeout(() => {
        // No second press came within the threshold, execute the single press action.
        this.singlePressTimer = null;
        this.singlePressAction();
      }, DOUBLE_PRESS_THRESHOLD);
    }
  }
}