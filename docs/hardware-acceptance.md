# Hardware acceptance checklist

Keep solenoid power disabled until both firmware builds are flashed and all six PCA boards are detected.

1. Flash Nano and ESP32 together.
2. Confirm Nano serial output says `Nano ready`; a missing address `0x40`–`0x45` must keep outputs disabled.
3. Provision Wi-Fi over BLE, reboot and confirm it reconnects without provisioning.
4. Leave Wi-Fi unavailable for 60 seconds and confirm BLE provisioning reappears.
5. Upload and play `piano_88_notes_1s_each.mid`; record the known high-note wiring mismatch and confirm the final unmapped key is reported by upload processing.
6. Play a dense song and verify at most ten simultaneous solenoids without queue overflow.
7. Pause, resume, restart and stop repeatedly; all active outputs must turn off immediately during pause/stop.
8. Disconnect the browser and MQTT while playing. Playback must continue locally and the retained state must restore the UI after reconnect.
9. Disconnect Wi-Fi while playing. Playback must finish locally and durable status must catch up after reconnect.
10. Interrupt SPI communication for more than two seconds. The Nano watchdog must clear its queue and all 96 outputs.
11. Test malformed/truncated artifact, wrong SHA-256, ESP32 reset and Nano reset. Every failure must leave all outputs off.
