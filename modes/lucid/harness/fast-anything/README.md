# Lucid roughness-map experiment

This harness builds a native version of `texture.mjs roughness` in a temporary directory. It uses the Rust implementation that Codex `gpt-6.2-astra` produced at high reasoning effort through fast-anything 0.8.0. The Lucid skill distributed to users keeps its JavaScript implementation.

On Ember Abbey’s 768 × 768 slate texture, the recorded function call took 21.8 ms in JavaScript and 3.8 ms in Rust. The complete `roughness` command took 154 ms and 136 ms respectively (medians of 21 interleaved runs per implementation). The resulting PNG and CLI JSON matched byte for byte.

## Reproduce

Use Node with `import.meta.main`, FFmpeg, Cargo and the `fast-anything` executable on your `PATH`. The recorded run used Node 25.1.0 and Rust 1.95.0 on an Apple M4 Max. From the repository root, run

```sh
npm exec --yes --package=@el4cteo/fast-anything@0.8.0 -- sh modes/lucid/harness/fast-anything/replay.sh
```

The script copies Lucid’s CLI, converts the bundled Ember Abbey textures to RGB PNGs, records a real call on `slate.png` and compiles `roughness.rs`. It checks that the native function loaded, compares the results on all four textures and seven smaller images, then times the full command in fresh processes. PNG decoding, compression and writing are included in that timing.

The last lines print the verified CLI and report paths. To try another supported albedo, use the printed path in place of `texture.mjs` below. Keep its experiment directory together with the compiled addon.

```sh
node texture.mjs roughness albedo.png roughness.png --json
FAST_ANYTHING_DISABLE=1 node texture.mjs roughness albedo.png reference.png --json
```
