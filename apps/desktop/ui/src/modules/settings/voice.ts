/* Settings › Models › Voice and speech (owner, 26 November: the mic is dictation and must just work; the voice circle is talking to
   bots and needs a voice model; "Set up voice" leads here). No board draws it: derived from board 14's rows.
   - Dictation: the local speech model as the host reports it (crates/boopis-dictation, ADR-0059): not downloaded (Download), being
     downloaded with its progress, ready with its size (Delete), or why the last download failed; the language it listens for (the host
     has none set: it hears which language is spoken). The mic needs none of this: its first press fetches the model.
   - Voice (talking to bots): the provider (ElevenLabs, Fish Audio, or a server on this computer). A provider's key is a secret Field
     whose value goes to the host's keychain and nowhere else (`SpeechSource.setKey`, the host's `secret_set`); the page only learns
     whether one is kept. A local server is its OpenAI-compatible speech address. There is no Test: the host cannot make a voice call
     yet. Talking itself has no release: once a voice is set up the voice circle says so. */
import { kit } from '@boopis/ui';
import { data } from '../../data';
import type { SpeechModel, SpeechSource, VoiceProvider, VoiceSettings } from '../../data';
import { fill, revealPart } from './page';
import { actionsHTML, buttonHTML, esc, openSelect, said, section, selectHTML } from './rows';
import type { RowOpts } from './rows';

const MB = (b: number): string => String(Math.max(1, Math.round(b / 1_000_000)));
/** the model's state in words, as the composer says it while it fetches ("12 of 57 MB") */
export function modelWords(m: SpeechModel): string {
  if (m.state === 'ready') return 'Ready, ' + MB(m.size) + ' MB';
  if (m.state === 'fetching') return 'Downloading, ' + MB(m.done) + ' of ' + MB(m.size) + ' MB';
  return 'Not downloaded';
}
const PROVIDERS: ReadonlyArray<{ value: VoiceProvider | 'none'; label: string; desc: string }> = [
  { value: 'none', label: 'None', desc: 'No voice.' },
  { value: 'elevenlabs', label: 'ElevenLabs', desc: 'Needs an API key.' },
  { value: 'fish_audio', label: 'Fish Audio', desc: 'Needs an API key.' },
  { value: 'local', label: 'A server on this computer', desc: 'An OpenAI-compatible server, like Kokoro or Piper.' }
];
const providerLabel = (p: VoiceProvider | null): string => PROVIDERS.find((x) => x.value === (p ?? 'none'))?.label ?? 'None';

/** the voice and speech sections, drawn into `host`; returns what reads them again */
export function mountVoice(host: HTMLElement, src: SpeechSource | undefined = data().speech): { refresh: () => Promise<void>; reveal: () => void } {
  if (!src) { host.replaceChildren(); return { refresh: async () => undefined, reveal: () => undefined }; }
  const speech = src;
  let model: SpeechModel | null = null, modelError = '', voice: VoiceSettings = { provider: null, localUrl: null }, hasKey = false, busy = false, poll = 0;
  const draw = (): void => {
    const dict: RowOpts[] = model
      ? [{
        label: 'Speech model', sub: model.failed ?? 'Turns what you say into text, on this computer.',
        control: '<span class="k7-row__value" data-model-state="' + model.state + '">' + esc(modelWords(model)) + '</span>' +
          actionsHTML(model.state === 'absent' ? buttonHTML('Download', { attrs: { 'data-speech': 'fetch' } }) : model.state === 'ready' ? buttonHTML('Delete', { variant: 'ghost', attrs: { 'data-speech': 'delete', 'aria-label': 'Delete the speech model' } }) : '')
      }, { label: 'Language', value: model.language ?? 'Automatic' }]
      : [{ label: 'Speech model', sub: modelError || 'Reading the speech model.' }];
    const p = voice.provider;
    const keyRow: RowOpts[] = p === 'elevenlabs' || p === 'fish_audio'
      ? [hasKey
        ? { label: 'API key', sub: 'Kept in your system’s keychain.', control: actionsHTML(buttonHTML('Change', { attrs: { 'data-voice': 'change-key' } }), buttonHTML('Remove', { variant: 'ghost', attrs: { 'data-voice': 'remove-key', 'aria-label': 'Remove the ' + providerLabel(p) + ' key' } })) }
        : { label: 'API key', sub: 'Stays in your system’s keychain.', control: kit.html.field({ id: 'hx-voice-key', secret: true, ariaLabel: providerLabel(p) + ' API key', placeholder: 'Paste the key' }) + actionsHTML(buttonHTML('Save', { variant: 'primary', attrs: { 'data-voice': 'save-key' } })) }]
      : p === 'local'
        ? [{ label: 'Speech address', control: kit.html.field({ id: 'hx-voice-url', inputType: 'url', ariaLabel: 'Speech address', value: voice.localUrl ?? '', placeholder: 'http://127.0.0.1:8880/v1/audio/speech', mono: true }) + actionsHTML(buttonHTML('Save', { variant: 'primary', attrs: { 'data-voice': 'save-url' } })) }]
        : [];
    fill(host,
      section('Dictation', dict, { 'data-part': 'dictation' }) +
      section('Voice', [{ label: 'Talking to bots', sub: 'Coming in a later update.', control: selectHTML('voice', 'Voice', providerLabel(p)) }, ...keyRow], { 'data-part': 'voice', id: 'hx-set-voice' }));
  };
  const readModel = async (): Promise<void> => {
    try { model = await speech.model(); modelError = ''; } catch (e) { model = null; modelError = 'The speech model could not be read: ' + said(e); }
    window.clearTimeout(poll);
    /* while it downloads, the row follows it (the host has no channel for it outside a dictation) */
    if (model?.state === 'fetching') poll = window.setTimeout(() => { void readModel().then(draw); }, 500);
  };
  const readVoice = async (): Promise<void> => {
    try { voice = await speech.voice(); hasKey = voice.provider === 'elevenlabs' || voice.provider === 'fish_audio' ? await speech.hasKey(voice.provider) : false; } catch (e) { kit.notify(said(e)); }
  };
  const act = (p: Promise<unknown>, done?: string): void => {
    if (busy) return;
    busy = true;
    p.then(() => { if (done) kit.notify(done); }, (e: unknown) => { kit.notify(said(e)); }).finally(() => { busy = false; void Promise.all([readModel(), readVoice()]).then(draw); });
  };
  host.addEventListener('click', (e) => {
    const t = e.target as Element;
    const s = t.closest<HTMLElement>('[data-speech]')?.dataset['speech'];
    if (s === 'fetch') { act(speech.fetchModel().then((m) => { model = m; })); return; }
    if (s === 'delete') { act(speech.deleteModel().then((m) => { model = m; }), 'Speech model deleted; the mic fetches it again'); return; }
    const sel = t.closest<HTMLElement>('[data-select="voice"]');
    if (sel) {
      openSelect(sel, { label: 'Voice', value: voice.provider ?? 'none', choices: PROVIDERS, onPick: (v) => {
        const provider = v === 'none' ? null : (v as VoiceProvider);
        /* a local server is kept once it has its address: until then the choice only shows its field */
        if (provider === 'local' && !voice.localUrl) { voice = { ...voice, provider }; hasKey = false; draw(); host.querySelector<HTMLInputElement>('#hx-voice-url')?.focus(); return; }
        act(speech.setVoice({ provider, localUrl: voice.localUrl }));
      } });
      return;
    }
    const v = t.closest<HTMLElement>('[data-voice]')?.dataset['voice'];
    const p = voice.provider;
    if (v === 'save-key' && (p === 'elevenlabs' || p === 'fish_audio')) {
      const input = host.querySelector<HTMLInputElement>('#hx-voice-key');
      const key = input?.value.trim() ?? '';
      if (input) input.value = '';   /* the key leaves the page at once: it is only in the keychain from here */
      if (!key) { kit.notify('Paste the key first'); return; }
      act(speech.setKey(p, key).then(() => speech.setVoice({ provider: p, localUrl: voice.localUrl })), 'Saved to your keychain');
    } else if (v === 'change-key') { hasKey = false; draw(); host.querySelector<HTMLInputElement>('#hx-voice-key')?.focus(); }
    else if (v === 'remove-key' && (p === 'elevenlabs' || p === 'fish_audio')) act(speech.deleteKey(p), 'The key was removed from your keychain');
    else if (v === 'save-url') {
      const url = host.querySelector<HTMLInputElement>('#hx-voice-url')?.value.trim() ?? '';
      if (!url) { kit.notify('Type the server’s speech address first'); return; }
      act(speech.setVoice({ provider: 'local', localUrl: url }), 'Saved');
    }
  });
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = (e.target as HTMLElement).id;
    if (id === 'hx-voice-key' || id === 'hx-voice-url') { e.preventDefault(); host.querySelector<HTMLElement>(id === 'hx-voice-key' ? '[data-voice="save-key"]' : '[data-voice="save-url"]')?.click(); }
  });
  draw();
  const refresh = async (): Promise<void> => { await Promise.all([readModel(), readVoice()]); draw(); };
  void refresh();
  return { refresh, reveal: () => { revealPart(host.querySelector('#hx-set-voice')?.closest('.k7-section') ?? null); } };
}
