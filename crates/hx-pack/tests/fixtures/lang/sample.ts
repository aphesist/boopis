// Sample module for outline tests.

export interface User {
  id: number;
  name: string;
}

/** A user id. */
export type UserId = number | string;

export enum Role {
  Admin,
  Guest,
}

export abstract class Repo<T> {
  abstract find(id: number): T | undefined;

  save(item: T): void {
    console.log(item);
  }
}

export class UserRepo extends Repo<User> {
  private users: User[] = [];

  find(id: number): User | undefined {
    return this.users.find((u) => u.id === id);
  }
}

export function greet(user: User): string {
  const label = (u: User) => u.name;
  return `hello ${label(user)}`;
}

export const double = (n: number): number => n * 2;

const helper = function (a: number) {
  return a;
};

namespace Util {
  export function noop() {}
}
