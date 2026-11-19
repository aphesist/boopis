// The `claude-code` module a mod imports. For the spike it exports the element constructors the
// example mods use. The real type declarations are not ours to copy (docs/MODS.md section 7).
const BRAND = Symbol.for('hx.element');

const isElement = (v) => v !== null && typeof v === 'object' && v[BRAND] === true;
const isProps = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !isElement(v);

function build(type, props, children) {
  const own = props ? { ...props } : {};
  const fromProps = 'children' in own ? [].concat(own.children) : [];
  delete own.children;
  return Object.freeze({ [BRAND]: true, type, props: Object.freeze(own), children: Object.freeze([...fromProps, ...children]) });
}

function constructor(type) {
  const make = (first, ...rest) => (isProps(first) ? build(type, first, rest) : build(type, null, first === undefined ? rest : [first, ...rest]));
  Object.defineProperty(make, 'name', { value: type });
  return make;
}

export const Box = constructor('Box');
export const Text = constructor('Text');
export const Button = constructor('Button');
export const Input = constructor('Input');
export const Select = constructor('Select');
export const Markdown = constructor('Markdown');
export const Code = constructor('Code');
export const Link = constructor('Link');
export const Svg = constructor('Svg');
export const Fragment = (props) => [].concat(props && props.children !== undefined ? props.children : []);
export const makeColors = (spec) => spec;
