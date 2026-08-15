export type KVValue = string | number | boolean | object | null;

export interface KV {
  get(key: string): KVValue | undefined;
  set(key: string, value: KVValue): void;
  rm(key: string): void;
}
