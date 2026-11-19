export interface Atom<T> {
  readonly id: string;
  readonly __type?: T;
}
