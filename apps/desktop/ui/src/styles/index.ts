/* Every stylesheet, in the v6 cascade order: tokens, the component library, the shell, then the modules. Each module's
   CSS lives beside its code; they are imported here so the order is one decision in one place. */
import '../components/kit.css';   /* the kit: tokens and the component library */
import '../host/first-run.css';
import '../modules/shell/shell.css';
import '../modules/cards/cards.css';
import '../modules/store/store.css';
import '../modules/session/session.css';
import '../modules/session/children.css';
import '../modules/session/council.css';
import '../modules/bots/bots.css';
import '../modules/bots/presence.css';
import '../modules/chat/chat.css';
import '../modules/dock/dock.css';
import '../modules/mods/mods.css';
import './fonts';
