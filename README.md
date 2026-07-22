# Self-Playing Piano

This repository contains the complete control system for the self-playing piano:

- `apps/web`: public song library, piano controls and authenticated administration.
- `packages/midi`: deterministic MIDI-to-piano artifact processing.
- `packages/database`: Neon/Postgres schema, migration and bootstrap utilities.
- `packages/infrastructure`: interchangeable Vercel Blob/S3 and MQTT adapters.
- `firmware/esp32`: Wi-Fi/BLE provisioning, MQTT, artifact playback and SPI scheduling.
- `firmware/nano`: safe event queue and six-board PCA9685 solenoid control.
- `tools/device-simulator`: MQTT/HTTP simulator for development without the piano.

The original MIDI remains in object storage. Postgres stores metadata and state; the ESP32 downloads one compact immutable `.spp` artifact into RAM when Play is requested.

## Local checks

Install Node.js 22+ and pnpm, then run:

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

PlatformIO firmware builds:

```sh
pio run --project-dir firmware/nano
pio run --project-dir firmware/esp32
```

## Cloud setup

1. Create Neon, a Vercel Blob store and an EMQX deployment.
2. Copy `.env.example` to `apps/web/.env.local` and fill every active value. The database and simulator commands load this same file for local development; Vercel uses its configured project environment instead.
3. Generate the administrator password hash:

   ```sh
   pnpm --filter @spp/web auth:hash -- "your-password"
   ```

4. Apply the schema and create/update the initial profile and piano:

   ```sh
   pnpm db:migrate
   pnpm db:bootstrap
   ```

   Bootstrap prints the piano UUID. Use that exact UUID in Vercel, EMQX and ESP32 configuration. `PIANO_DEVICE_TOKEN` must also be identical during bootstrap and firmware configuration.

5. Import this repository into Vercel with the repository root as the project root. Add the production variables from `.env.example`; `vercel.json` builds the pnpm workspace and serves `apps/web`.
6. Configure the EMQX identities and authorization rules in [docs/emqx.md](docs/emqx.md).
7. Copy `firmware/esp32/platformio_override.example.ini` to `firmware/esp32/platformio_override.ini`, fill the device settings and add a trusted root CA through `SPP_TLS_ROOT_CA` for production.
8. With solenoid power disabled, flash both devices. The SPI protocol is intentionally incompatible with the old firmware, so do not update only one board.
9. Power the ESP32 and provision Wi-Fi with Espressif's provisioning app. Use the BLE device named `Piano-…` and the proof-of-possession value configured by `SPP_PROVISION_POP`.
10. Sign in at `/admin` and batch-upload the MIDI files from `firmware/esp32/midi_files` if they should form the initial library.

## Important hardware defaults

- Playback accepts MIDI 21–108 and caps polyphony at 10.
- Repeated activation of one key keeps a 100 ms release gap.
- Velocity is preserved but v1 intentionally drives every active solenoid at PWM 4095.
- The `legacy-v1` map preserves the current wiring: logical keys 0–72 use outputs 8–80, keys 73–86 use 82–95, and key 87 is explicitly unmapped.
- Every stop, error, watchdog timeout and boot clears all 96 PCA outputs.

Investigating the shifted high-note wiring only requires updating the 88-entry map, incrementing the profile/firmware version and reprocessing songs. The external artifact, MQTT and SPI shapes already carry logical keys and velocity.

## Device simulator

With the web app and EMQX configured, populate the simulator variables from `.env.example` and run:

```sh
pnpm --filter @spp/device-simulator dev
```

It uses the same desired/reported topics, artifact endpoint and durable status endpoint as the ESP32.
