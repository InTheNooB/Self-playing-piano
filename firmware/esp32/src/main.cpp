#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <MQTT.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#if __has_include(<WiFiProv.h>)
#include <WiFiProv.h>
#define SPP_HAS_WIFI_PROVISIONING 1
#else
#define SPP_HAS_WIFI_PROVISIONING 0
#endif

#include "artifact.h"
#include "config.h"
#include "playback_controller.h"
#include "spi_transport.h"

namespace {

WiFiClientSecure g_mqttTls;
MQTTClient g_mqtt(2048);
Preferences g_preferences;
QueueHandle_t g_commandQueue = nullptr;
spp::SpiTransport g_spi;
spp::ArtifactDownloader g_downloader;
spp::PlaybackController g_playback(g_spi, g_downloader);

String g_desiredTopic;
String g_reportedTopic;
uint32_t g_wifiStartedAtMs = 0;
uint32_t g_lastMqttAttemptMs = 0;
uint32_t g_mqttBackoffMs = 1000;
uint32_t g_lastReportedMs = 0;
uint32_t g_lastDurableHeartbeatMs = 0;
bool g_provisioning = false;

void configureTls(WiFiClientSecure& client) {
  if (strlen(spp::config::kTlsRootCa) > 0) client.setCACert(spp::config::kTlsRootCa);
  else client.setInsecure();
}

String isoTimestamp() {
  time_t now = time(nullptr);
  if (now < 100000) return "1970-01-01T00:00:00Z";
  struct tm value {};
  gmtime_r(&now, &value);
  char result[24]{};
  strftime(result, sizeof(result), "%Y-%m-%dT%H:%M:%SZ", &value);
  return String(result);
}

bool expired(const char* iso) {
  const time_t now = time(nullptr);
  if (now < 100000 || !iso || strlen(iso) < 19) return false;
  struct tm parsed {};
  if (!strptime(iso, "%Y-%m-%dT%H:%M:%S", &parsed)) return true;
  return now > mktime(&parsed);
}

String reportedPayload(bool online) {
  const auto snapshot = g_playback.snapshot();
  JsonDocument document;
  document["pianoId"] = spp::config::kPianoId;
  document["state"] = online ? spp::stateName(snapshot.state) : "offline";
  document["online"] = online;
  if (strlen(snapshot.sessionId) > 0) document["sessionId"] = snapshot.sessionId;
  if (strlen(snapshot.songId) > 0) document["songId"] = snapshot.songId;
  document["positionMs"] = snapshot.positionMs;
  document["durationMs"] = snapshot.durationMs;
  document["firmwareVersion"] = spp::config::kFirmwareVersion;
  document["profileId"] = "legacy-v1";
  document["lastAppliedRevision"] = snapshot.lastAppliedRevision;
  if (strlen(snapshot.commandId) > 0) document["lastCommandId"] = snapshot.commandId;
  document["reportedAt"] = isoTimestamp();
  if (strlen(snapshot.errorCode) > 0) {
    document["error"]["code"] = snapshot.errorCode;
    document["error"]["message"] = snapshot.errorMessage;
  }
  String payload;
  serializeJson(document, payload);
  return payload;
}

void publishReported() {
  if (!g_mqtt.connected()) return;
  g_mqtt.publish(g_reportedTopic, reportedPayload(true), true, 1);
  g_lastReportedMs = millis();
}

void postDurableStatus() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  configureTls(client);
  HTTPClient request;
  if (!request.begin(client, String(spp::config::kApiBaseUrl) + "/api/device/status")) return;
  request.addHeader("Authorization", String("Bearer ") + spp::config::kDeviceToken);
  request.addHeader("Content-Type", "application/json");
  request.setTimeout(5000);
  request.POST(reportedPayload(true));
  request.end();
  g_lastDurableHeartbeatMs = millis();
}

bool parseCommand(const String& payload, spp::DesiredCommand& command) {
  JsonDocument document;
  if (deserializeJson(document, payload) != DeserializationError::Ok) return false;
  if (strcmp(document["pianoId"] | "", spp::config::kPianoId) != 0) return false;
  if (expired(document["expiresAt"] | "")) return false;
  command.type = spp::commandTypeFrom(document["type"] | "");
  command.revision = document["revision"] | 0;
  command.artifactBytes = document["artifactBytes"] | 0;
  strlcpy(command.commandId, document["commandId"] | "", sizeof(command.commandId));
  strlcpy(command.sessionId, document["sessionId"] | "", sizeof(command.sessionId));
  strlcpy(command.songId, document["songId"] | "", sizeof(command.songId));
  strlcpy(command.artifactId, document["artifactId"] | "", sizeof(command.artifactId));
  strlcpy(command.artifactSha256, document["artifactSha256"] | "", sizeof(command.artifactSha256));
  return command.type != spp::CommandType::kInvalid && command.revision > 0;
}

void onMqttMessage(String& topic, String& payload) {
  if (topic != g_desiredTopic || !g_commandQueue) return;
  spp::DesiredCommand command;
  if (!parseCommand(payload, command)) return;
  xQueueSend(g_commandQueue, &command, 0);
}

void startProvisioning() {
  if (g_provisioning) return;
  g_provisioning = true;
  WiFi.setAutoReconnect(false);
  if (WiFi.status() == WL_CONNECTED) WiFi.disconnect(false, false);
  g_playback.setConnectivityState(spp::DeviceState::kProvisioning);
#if SPP_HAS_WIFI_PROVISIONING
  const String serviceName = String("Piano-") + String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX);
  WiFiProv.beginProvision(WIFI_PROV_SCHEME_BLE,
                          WIFI_PROV_SCHEME_HANDLER_FREE_BTDM,
                          WIFI_PROV_SECURITY_1,
                          spp::config::kProvisionPop,
                          serviceName.c_str());
#else
  Serial.println("BLE Wi-Fi provisioning is unavailable in this Arduino core");
#endif
}

void stopProvisioning() {
  if (!g_provisioning) return;
  g_provisioning = false;
  WiFi.setAutoReconnect(true);
}

void connectMqtt() {
  if (g_mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  if (millis() - g_lastMqttAttemptMs < g_mqttBackoffMs) return;
  g_lastMqttAttemptMs = millis();

  const String clientId = String("piano-") + spp::config::kPianoId;
  const String will = reportedPayload(false);
  g_mqtt.setWill(g_reportedTopic.c_str(), will.c_str(), true, 1);
  if (g_mqtt.connect(clientId.c_str(), spp::config::kMqttUsername,
                     spp::config::kMqttPassword)) {
    g_mqtt.subscribe(g_desiredTopic, 1);
    g_mqttBackoffMs = 1000;
    publishReported();
    return;
  }
  g_mqttBackoffMs = min<uint32_t>(g_mqttBackoffMs * 2 + random(0, 500), 30000);
}

void handleConnectivity() {
  if (WiFi.status() == WL_CONNECTED) {
    if (g_provisioning) stopProvisioning();
    const auto state = g_playback.snapshot().state;
    if (state == spp::DeviceState::kConnecting || state == spp::DeviceState::kProvisioning) {
      g_playback.setConnectivityState(spp::DeviceState::kIdle);
    }
    connectMqtt();
    g_mqtt.loop();
    return;
  }

  if (g_playback.idle() && !g_provisioning) g_playback.setConnectivityState(spp::DeviceState::kConnecting);
  if (!g_provisioning && millis() - g_wifiStartedAtMs >= spp::config::kWifiProvisionTimeoutMs) startProvisioning();
}

void handleCommands() {
  spp::DesiredCommand command;
  while (xQueueReceive(g_commandQueue, &command, 0) == pdTRUE) {
    const bool accepted = g_playback.handle(command);
    if (!accepted) continue;
    if (command.type == spp::CommandType::kEnterProvisioning) startProvisioning();
    g_preferences.putULong("lastRevision", command.revision);
    publishReported();
    postDurableStatus();
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  randomSeed(esp_random());
  g_commandQueue = xQueueCreate(6, sizeof(spp::DesiredCommand));
  g_preferences.begin("piano", false);
  g_desiredTopic = String(spp::config::kTopicPrefix) + "/" + spp::config::kPianoId + "/v1/desired";
  g_reportedTopic = String(spp::config::kTopicPrefix) + "/" + spp::config::kPianoId + "/v1/reported";

  g_spi.begin();
  g_playback.begin(g_preferences.getULong("lastRevision", 0));
  g_playback.setConnectivityState(spp::DeviceState::kConnecting);

  configureTls(g_mqttTls);
  g_mqtt.begin(spp::config::kMqttHost, spp::config::kMqttPort, g_mqttTls);
  g_mqtt.onMessage(onMqttMessage);
  g_mqtt.setKeepAlive(20);
  g_mqtt.setTimeout(5000);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin();
  g_wifiStartedAtMs = millis();
  setenv("TZ", "UTC0", 1);
  tzset();
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
}

void loop() {
  handleConnectivity();
  handleCommands();
  g_playback.tick();

  const bool changed = g_playback.consumeDirty();
  if (changed || millis() - g_lastReportedMs >= spp::config::kReportedIntervalMs) publishReported();
  if (changed || millis() - g_lastDurableHeartbeatMs >= spp::config::kDurableHeartbeatMs) postDurableStatus();
  delay(2);
}
