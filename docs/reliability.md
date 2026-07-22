# Reliability model

The device runtime has two responsibilities:

- The ESP32 playback task exclusively owns the playback state machine, SPI transport and Nano heartbeat.
- The ESP32 network side exclusively owns Wi-Fi, BLE provisioning, time synchronization, MQTT and HTTP.

They exchange bounded typed messages. MQTT callbacks never mutate playback state, and slow HTTP/MQTT operations cannot delay SPI supervision. The Nano executes only acknowledged, CRC-protected protocol-v2 frames and clears all outputs if the heartbeat stops.

Cloud command dispatch is deliberately safety-biased:

1. Neon atomically reserves the piano, session and revision.
2. Vercel publishes the retained MQTT desired state and waits for QoS 1 acknowledgement.
3. A connection failure is known not to have published and may release a newly reserved session.
4. A publish timeout is ambiguous, so the session remains locked until its device acknowledgement or an explicit Stop supersedes it.

There is no offline Play queue and no background dispatcher. This avoids surprise playback after an outage and keeps the deployed architecture limited to Vercel, Neon, object storage and EMQX.

Artifacts are immutable. Reprocessing creates a new current artifact while existing sessions retain the exact artifact they used. Archiving removes a song from the library without destroying referenced history or objects.
