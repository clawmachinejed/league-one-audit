export interface ConfigPort {
  get<T = string>(key: string, fallback?: T): T;
  enabled(key: string): boolean;
}
