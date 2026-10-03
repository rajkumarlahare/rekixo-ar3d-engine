export class SnapshotHistory<T> {
  readonly limit: number;
  #undo: T[] = [];
  #redo: T[] = [];

  constructor(limit = 40) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  get undoDepth() {
    return this.#undo.length;
  }

  get redoDepth() {
    return this.#redo.length;
  }

  clear() {
    this.#undo = [];
    this.#redo = [];
  }

  record(previous: T) {
    this.#undo.push(previous);
    if (this.#undo.length > this.limit) this.#undo.shift();
    this.#redo = [];
  }

  undo(current: T): T | undefined {
    const previous = this.#undo.pop();
    if (previous === undefined) return undefined;
    this.#redo.push(current);
    return previous;
  }

  redo(current: T): T | undefined {
    const next = this.#redo.pop();
    if (next === undefined) return undefined;
    this.#undo.push(current);
    if (this.#undo.length > this.limit) this.#undo.shift();
    return next;
  }
}
