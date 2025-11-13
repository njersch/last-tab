/**
 * A queue that stores items in a queue,
 * ensuring that each item is unique.
 */
export default class SetQueue {
  
  /**
   * Creates a new SetQueue.
   * @param {Array} items - The initial items to add to the queue.
   * @param {Function} equals - A function that returns true if two items are equal.
   */
  constructor(items, equals = (a, b) => a === b) {
    if (items) {
      this.queue = items;
    } else {
      this.queue = [];
    }
    this.equals = equals;
  }

  /**
   * Returns the number of items in the queue.
   * @returns {number} The number of items in the queue.
   */
  size() {
    return this.queue.length;
  }

  /**
   * Returns an array of the items in the queue.
   * @returns {Array} The items in the queue.
   */
  toArray() {
    return Array.from(this.queue);
  }
  
  /**
   * Returns the index of the first item that is equal to the given item.
   * @param {Object} item - The item to find the index of.
   * @returns {number} The index of the item.
   */
  indexOf(item) {
    return this.findIndex(i => this.equals(i, item));
  }

  /**
   * Returns the index of the first item that satisfies the given predicate.
   * @param {Function} predicate - A function that returns true if the item satisfies the predicate.
   * @returns {number} The index of the item.
   */
  findIndex(predicate) {
    return this.queue.findIndex(predicate);
  }

  /**
   * Returns the first item in the queue.
   * @returns {Object} The first item in the queue.
   */
  first() {
    return this.queue[0];
  }

  /**
   * Returns the last item in the queue.
   * @returns {Object} The last item in the queue.
   */
  last() {
    return this.queue.last();
  }

  /**
   * Returns the item at the given index.
   * @param {number} index - The index of the item to return.
   * @returns {Object} The item at the given index.
   */
  at(index) {
    return this.queue[index];
  }

  /**
   * Adds an item to the front of the queue.
   * @param {Object} item - The item to add to the front of the queue.
   */
  addFirst(item) {
    this.remove(item);
    this.queue.unshift(item);
  }

  /**
   * Removes the last item from the queue.
   */
  removeLast() {
    this.queue.pop();
  }

  /**
   * Removes the first item from the queue.
   * @param {Object} item - The item to remove from the queue.
   */
  remove(item) {
    const index = this.indexOf(item);
    if (index > -1) {
      this.queue.splice(index, 1);
    }
  }
  
  /**
   * Clears the queue.
   */
  clear() {
    this.queue = [];
  }
}