// Minimal @minecraft/server(+ui) stub for unit tests under Node.
// Only import-time surface is needed; tests never call game APIs.
export const world = {
  getDimension: () => {
    throw new Error("not available outside Minecraft");
  },
  sendMessage: () => {},
};
export const system = { run: (fn: () => void) => fn() };
export const BlockComponentTypes = {};
export class ObservableString {
  constructor(public value: string) {}
  subscribe() {}
  getData() {
    return this.value;
  }
  setData(v: string) {
    this.value = v;
  }
}
export class ObservableBoolean {
  constructor(public value: boolean) {}
  subscribe() {}
  getData() {
    return this.value;
  }
  setData(v: boolean) {
    this.value = v;
  }
}
export class ObservableNumber {
  constructor(public value: number) {}
  subscribe() {}
  getData() {
    return this.value;
  }
  setData(v: number) {
    this.value = v;
  }
}
