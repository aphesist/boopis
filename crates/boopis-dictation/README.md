# boopis-dictation

The microphone button's other half: it hears a person and writes down what they said, on this computer. The desktop host
(`apps/desktop/src-tauri`, `src/dictation.rs`) is its only user. Why it is built this way: ADR-0052 (`docs/DECISIONS.md`).

It is a crate of its own so that it builds and is tested without the web view's toolkit, and so that the only way to the
microphone is a `Dictation` somebody was handed.

## What it does

| Module | What |
|---|---|
| `service` | `Dictation`: `start(&sink) -> id`, `stop(id)`, `stop_all()`. One dictation at a time; a second one gets `busy`. Fetches the model on first use, opens the microphone, runs the session on its own thread |
| `session` | one dictation: source, resampler, segmenter, the speech thread (`Worker`), and `Warm`, which keeps the model in memory between dictations and drops it after `Tuning::model_idle` |
| `segment` | the state machine, with no thread or clock in it: stretches cut at pauses, partials while speaking, the cap, a silent microphone. Time is counted in samples |
| `audio` | `AudioSource` (what a session reads), the resampler to 16 kHz, the level of a frame, the downmix |
| `capture` | `SystemMicrophone`: the default input device through cpal (ALSA, WASAPI, Core Audio). `Microphone` is the trait the tests replace with a file |
| `transcribe` | `Whisper` (whisper.cpp through whisper-rs, CPU), behind `Recognizer` and `Transcriber` |
| `model` | the table of models (`MODELS`; `base-q5_1` is the default), their pinned SHA-256, and `read_verified` |
| `fetch` | the one-time download: resumable, redirects checked hop by hop, hashed before the file gets its name. The HTTPS is the host's (`Transport`) |

A caller gets `Event`s: `Preparing { done, total }` (bytes of the model), `Listening`, `Partial { text }` (the stretch so
far; each replaces the last), `Final { text }` (a finished stretch; it stays), `Error { reason, message, retry }` and
`Ended`, always last. `Reason` is one of `no-microphone`, `permission-denied`, `model-download-failed`, `busy`, `too-long`,
`failed`; `message` is a plain sentence for the person.

## Invariants

- **Audio stays here.** It is read into memory, written down and dropped: never to a file, a log or a socket. `Job`'s
  `Debug` prints sizes, not samples or words.
- **The model is untrusted until its hash matches.** The fetch writes `<file>.part`, hashes it and only then renames it;
  the loader reads the file, hashes those bytes and hands the same bytes to whisper.cpp. A file that is not the model is
  deleted and reported, never loaded.
- **Nothing starts by itself.** No thread, device or request exists until `Dictation::start`; the microphone is open
  only between `Listening` and the end of listening, and closes on stop, on the cap, on an error and when the sink says
  nobody reads the events.
- **One whisper.cpp for every processor.** `.cargo/config.toml` at the repository root pins the x86-64 instruction set
  (AVX2, FMA, F16C, BMI2), and `transcribe::check_processor` refuses to load a model where they are missing, so an older
  computer gets a sentence instead of an illegal instruction.
- **Numbers are data.** `Tuning` and `fetch::Policy`; nothing in the code decides a duration.

## Build

whisper.cpp is compiled from source by `whisper-rs-sys`: CMake, a C++ compiler and (for bindgen) libclang. On Linux the
microphone needs ALSA's headers:

```sh
sudo apt-get install -y libasound2-dev cmake clang     # Arch: alsa-lib cmake clang
```

## Test

```sh
cargo test -p boopis-dictation                         # 52 unit tests: no network, no microphone, no model
HX_DICTATION_MODEL=/path/to/ggml-base-q5_1.bin cargo test -p boopis-dictation --test speech -- --nocapture
```

The second line is the proof that it hears: `tests/speech.rs` plays `tests/fixtures/jfk.wav` to a real `Dictation` (as a
16 kHz and as a 48 kHz microphone, and once at the speed it was spoken) and checks the words whisper.cpp wrote. Without
`HX_DICTATION_MODEL` those tests skip and say so; CI's `dictation` job sets it, with `HX_DICTATION_REQUIRE_MODEL=1`, which
turns a skip into a failure. `capture`'s own test opens the real default device wherever it runs: on a machine without a
microphone it must answer `no-microphone`, in time. **No test here speaks into a real microphone.**
