# Reliability model

The device runtime has two responsibilities:

- The ESP32 playback task exclusively owns the playback state machine, SPI transport and Nano heartbeat.
- The ESP32 network side exclusively owns Wi-Fi, BLE provisioning, time synchronization, MQTT and HTTP.
- BLE provisioning is a boot mode. A safe Wi-Fi timeout or admin request is persisted in NVS before a software restart, allowing Bluetooth memory to be released during normal operation without preventing future provisioning.

They exchange bounded typed messages. MQTT callbacks never mutate playback state, and slow HTTP/MQTT operations cannot delay SPI supervision. The Nano executes only acknowledged, CRC-protected protocol-v2 frames and clears all outputs if the heartbeat stops.

Cloud command dispatch is deliberately safety-biased:

1. Neon atomically reserves the piano, session and revision.
2. Vercel publishes the retained MQTT desired state and waits for QoS 1 acknowledgement.
3. A connection failure is known not to have published and may release a newly reserved session.
4. A publish timeout is ambiguous, so the session remains locked until its device acknowledgement or an explicit Stop supersedes it.

There is no offline Play queue and no background dispatcher. This avoids surprise playback after an outage and keeps the deployed architecture limited to Vercel, Neon, object storage and EMQX.

The ESP32 is authoritative for live runtime state. Browsers use its retained MQTT report for both the global status indicator and the diagnostics current-state card. Neon is the durable arbitration and history mirror, not a second live authority.

Significant device transitions, command acknowledgements and session outcomes enter a bounded in-memory outbox. The ESP32 posts them to the device-status endpoint in order, checks the HTTP response and retries failures with capped exponential backoff. If the outbox approaches capacity, MQTT command intake pauses until delivery recovers; transitions are not silently replaced by newer state. The once-per-minute durable heartbeat uses the same delivery path.

After a reboot, an idle device may recover an orphaned cloud session only when its NVS-persisted handled revision covers every command issued by the server. A matching applied Stop finalizes the session as stopped; any other missing terminal outcome is recorded as a failure before the piano is unlocked.

Admin diagnostics provide two session-independent recovery commands. Emergency recovery clears the scheduler and returns to idle only after the Nano acknowledges all-off. Safe controller restart performs the same shutdown, delivers its acknowledgement through the durable outbox, and only then restarts the ESP32. Neither action can clear or bypass a failed all-off; the Nano watchdog remains the final shutdown path.

Artifacts are immutable. Reprocessing creates a new current artifact while existing sessions retain the exact artifact they used. Archiving removes a song from the library without destroying referenced history or objects.

Artifact v2 stores musical strike time and actuator lead separately. The browser renders the strike time while the ESP32 schedules note-on at `strike - activationLead`; note-off remains at the musical end. Polyphony and same-key reset validation operate on these expanded electrical intervals. Firmware continues to accept v1 artifacts with zero actuator lead during a staged library migration.
