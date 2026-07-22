#pragma once

#ifndef SPP_FIRMWARE_VERSION
#define SPP_FIRMWARE_VERSION "2.0.0"
#endif
#ifndef SPP_PIANO_ID
#define SPP_PIANO_ID "00000000-0000-0000-0000-000000000000"
#endif
#ifndef SPP_API_BASE_URL
#define SPP_API_BASE_URL "https://example.vercel.app"
#endif
#ifndef SPP_DEVICE_TOKEN
#define SPP_DEVICE_TOKEN "replace-me"
#endif
#ifndef SPP_MQTT_HOST
#define SPP_MQTT_HOST "broker.example.com"
#endif
#ifndef SPP_MQTT_PORT
#define SPP_MQTT_PORT 8883
#endif
#ifndef SPP_MQTT_USERNAME
#define SPP_MQTT_USERNAME "piano-device"
#endif
#ifndef SPP_MQTT_PASSWORD
#define SPP_MQTT_PASSWORD "replace-me"
#endif
#ifndef SPP_MQTT_TOPIC_PREFIX
#define SPP_MQTT_TOPIC_PREFIX "pianos"
#endif
#ifndef SPP_PROVISION_POP
#define SPP_PROVISION_POP "piano-setup"
#endif
#ifndef SPP_TLS_ROOT_CA
#define SPP_TLS_ROOT_CA ""
#endif

namespace spp::config {
constexpr const char* kFirmwareVersion = SPP_FIRMWARE_VERSION;
constexpr const char* kPianoId = SPP_PIANO_ID;
constexpr const char* kApiBaseUrl = SPP_API_BASE_URL;
constexpr const char* kDeviceToken = SPP_DEVICE_TOKEN;
constexpr const char* kMqttHost = SPP_MQTT_HOST;
constexpr uint16_t kMqttPort = SPP_MQTT_PORT;
constexpr const char* kMqttUsername = SPP_MQTT_USERNAME;
constexpr const char* kMqttPassword = SPP_MQTT_PASSWORD;
constexpr const char* kTopicPrefix = SPP_MQTT_TOPIC_PREFIX;
constexpr const char* kProvisionPop = SPP_PROVISION_POP;
constexpr const char* kTlsRootCa = SPP_TLS_ROOT_CA;
constexpr uint32_t kWifiProvisionTimeoutMs = 60000;
constexpr uint32_t kDurableHeartbeatMs = 60000;
constexpr uint32_t kReportedIntervalMs = 1000;
constexpr size_t kMaxArtifactBytes = 128 * 1024;
}  // namespace spp::config
