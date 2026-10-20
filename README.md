# Dual-Tone External Test Generator

A standalone HTML/CSS/JS page that transmits the same 36-symbol dual-tone
signal set as the Python decoder, plus white/pink noise and a handful of
"should be rejected" edge cases — so you can validate the decoder over a
**real acoustic path** (a second device's speaker &rarr; air &rarr; your
microphone), not just the decoder's own internal simulator.

It shares no code with the Python project — it's an independent
reimplementation of the same frequency table, built in the browser with the
Web Audio API. If the decoder agrees with what this page played, that's a
meaningfully stronger check than the decoder agreeing with itself.

## Frequency table (must match the Python side)

```
         1600   1900   2250   2575   2825   3125
  725      A      B      C      D      E      F
  825      G      H      I      J      K      L
 1025      M      N      O      P      Q      R
 1150      S      T      U      V      W      X
 1325      Y      Z      0      1      2      3
 1475      4      5      6      7      8      9
```

If you ever change `LOW_GROUP` / `HIGH_GROUP` in the Python decoder, update
the same two arrays at the top of `script.js` to match.

## Host it on GitHub Pages

1. Create a new repo (or a folder in an existing one) and add these four
   files: `index.html`, `style.css`, `script.js`, `README.md`.
2. Push to GitHub.
3. In the repo: **Settings &rarr; Pages &rarr; Build and deployment &rarr;
   Source: Deploy from a branch**, pick `main` and `/ (root)`, save.
4. GitHub gives you a URL like `https://<user>.github.io/<repo>/` — open
   that on whatever device will act as the external noise/tone source
   (a phone works well).

No build step, no dependencies, no backend — it's three static files.

## Using it alongside the Python decoder

1. Start the Python program in Real-Time Mode and pick a microphone.
2. Open this page on a **different** device (or the same machine with a
   separate speaker), tap anywhere once to arm audio (required by browser
   autoplay rules), and place it near that microphone.
3. **Signal panel** — type a message or click cells in the frequency
   matrix; each cell shows its low/high frequency pair on hover. Adjust
   tone duration, the gap between characters, output level, frequency
   deviation, and low/high tone imbalance to match whatever condition
   you're testing.
4. **Noise panel** — switch between white and pink noise, set a level,
   and press *Start noise* to run it continuously underneath the tones;
   the level ratio readout gives a rough reference figure (not a true
   acoustic SNR — that depends on your speaker, room, and mic).
   *Click/pop burst* fires a one-off transient to check the decoder
   doesn't false-trigger on impulsive noise.
5. **Invalid-signal tests** (under the disclosure arrow) deliberately
   send things the decoder should refuse: a single tone with no partner,
   three simultaneous tones, frequencies outside the table, and tones
   forced to 80 ms (too short) or 1400 ms (overlong). The decoder should
   report `INVALID / NO SIGNAL` (or the matching too-short/overlong
   status) for every one of these — if it ever decodes a character
   instead, that's a real finding.
6. The **output monitor** at the bottom is a live oscilloscope trace of
   whatever this page is currently playing, so you can visually confirm
   audio is actually being generated before you start checking the mic
   side.

## Notes

- Everything runs client-side via the Web Audio API; nothing is recorded,
  uploaded, or sent anywhere.
- Audio only starts after a tap/click, per browser autoplay policy — the
  status light in the header shows whether audio is armed yet.
- Tested with a mocked Web Audio API + jsdom (23/23 automated checks) and
  validated with html-validate; always worth a quick listen on your own
  hardware before a real test session, since real speakers/microphones
  behave differently from the simulator in the Python repo's `--selftest`.
