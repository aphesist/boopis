// Sample module for outline tests.

/** Adds two numbers. */
export function add(a, b) {
  return a + b;
}

function* ids() {
  let i = 0;
  while (true) yield i++;
}

class Counter {
  constructor() {
    this.n = 0;
  }

  increment() {
    this.n += 1;
    return this.n;
  }
}

const square = (x) => x * x;

var legacy = function (y) {
  return y;
};

module.exports = { add, Counter, square };
