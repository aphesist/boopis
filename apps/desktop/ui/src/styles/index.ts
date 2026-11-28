/* Every stylesheet, in the cascade order: the tokens, the engines the kit draws with, the kit, the shell, then the modules. Each module's
   CSS lives beside its code; they are imported here so the order is one decision in one place. */
import './tokens.css';   /* the app's themes (the presets, Settings > Appearance); the v7 kit's own tokens are on a v7 root */
import '../components/corners.css';   /* the corner engine and the app root */
import '../components/scroll.css';
import '../components/orb.css';
import '../components/markdown.css';
import '../components/model-mark.css';
import '../components/signin-marks.css';
import '../components/v7/kit-v7.css';   /* the v7 kit: its tokens on a v7 root and its components (wave C moves the screens onto it) */
import '../host/connectors.css';
import '../host/notice.css';
import '../modules/shell/shell.css';
import '../modules/cards/cards.css';
import '../modules/store/store.css';
import '../modules/session/session.css';
import '../modules/session/children.css';
import '../modules/bots/bots.css';
import '../modules/chat/chat.css';
import '../modules/dock/dock.css';
import '../modules/mods/mods.css';
import '../modules/onboarding/onboarding.css';
import './fonts';
