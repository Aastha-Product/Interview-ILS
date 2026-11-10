// jsdom has no DataTransfer, and its <input type="file"> only takes a real FileList: enough of
// both for attaching a file the way Chrome does.
class TestDataTransfer {
  private readonly list: File[] = [];
  readonly items = { add: (file: File) => void this.list.push(file) };
  get files(): FileList {
    const files = [...this.list];
    return Object.assign(files, { item: (index: number) => files[index] ?? null }) as unknown as FileList;
  }
}

if (typeof globalThis.DataTransfer === "undefined") {
  Object.assign(globalThis, { DataTransfer: TestDataTransfer });
  const store = new WeakMap<HTMLInputElement, FileList>();
  Object.defineProperty(HTMLInputElement.prototype, "files", {
    configurable: true,
    get(this: HTMLInputElement) {
      return store.get(this) ?? (Object.assign([], { item: () => null }) as unknown as FileList);
    },
    set(this: HTMLInputElement, files: FileList) {
      store.set(this, files);
    },
  });
}
