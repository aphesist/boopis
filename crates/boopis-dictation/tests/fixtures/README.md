# Fixtures

`jfk.wav`: eleven seconds of President John F. Kennedy's inaugural address (20 January 1961), 16 kHz, mono, 16-bit PCM,
352 078 bytes, SHA-256 `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`. It is whisper.cpp's own sample
(`samples/jfk.wav` at tag v1.8.3). The recording is a work of the United States federal government and is in the public
domain.

"And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country."

`tests/speech.rs` plays it to a dictation as a microphone would and reads the words back, with the real speech model.
