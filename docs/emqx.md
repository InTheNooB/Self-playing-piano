# EMQX configuration

Use TLS MQTT for the ESP32 and Vercel publisher, plus secure WebSocket MQTT for browsers. Disable anonymous access.

Create three identities:

| Identity | Subscribe | Publish |
| --- | --- | --- |
| `vercel-publisher` | none | `pianos/+/v1/desired` |
| `piano-device` | `pianos/{pianoId}/v1/desired` | `pianos/{pianoId}/v1/reported` |
| `browser-readonly` | `pianos/+/v1/reported` | none |

Explicitly deny every other topic/action after the allow rules. The browser password is intentionally not treated as a secret; its account is safe only because the broker ACL gives it no publishing permission. If public status is undesirable, replace it with short-lived broker credentials later without changing the MQTT payloads.

Recommended broker settings:

- MQTT 3.1.1 or 5 over TLS on port 8883.
- MQTT over secure WebSocket at `/mqtt`.
- Retained messages and QoS 1 enabled.
- Persistent retained Last Will on the reported topic.
- Client ID uniqueness enforced; use one device identity per piano.
- Certificate chain trusted by the ESP32 firmware.

The Vercel application opens a short MQTT connection only while dispatching a command. The ESP32 holds its connection open while powered. A desired command is retained and revisioned; the device persists the last applied revision and does not replay older commands after reconnecting.

Switching brokers requires recreating these identities/ACLs and changing environment/device connection values. Application code and topics remain unchanged.
