/* The one place the lab imports the component library from. Stories use the library's public API (`ui`, its
   factories, props and variants), never a module's internals, so when the library moves into its own package only
   this import changes. */
export { ui, html } from '../components';
export type { Ui } from '../components';
