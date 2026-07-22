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

enum class PlaybackMessageType : uint8_t {
  kCommand,
  kArtifactReady,
  kArtifactFailed,
  kConnectivity,
};

struct PlaybackMessage {
  PlaybackMessageType type = PlaybackMessageType::kCommand;
  spp::DesiredCommand command{};
  spp::Artifact* artifact = nullptr;
  spp::DeviceState connectivityState = spp::DeviceState::kConnecting;
  char error[160]{};
};

enum class NetworkActionType : uint8_t { kDownloadArtifact, kEnterProvisioning };

struct NetworkAction {
  NetworkActionType type = NetworkActionType::kDownloadArtifact;
  spp::DesiredCommand command{};
};

WiFiClientSecure g_mqttTls;
MQTTClient g_mqtt(2048);
Preferences g_preferences;
QueueHandle_t g_playbackQueue = nullptr;
QueueHandle_t g_networkActionQueue = nullptr;
QueueHandle_t g_snapshotQueue = nullptr;
spp::SpiTransport g_spi;
spp::ArtifactDownloader g_downloader;
spp::PlaybackController g_playback(g_spi);
spp::PlaybackSnapshot g_latestSnapshot{};

String g_desiredTopic;
String g_reportedTopic;
uint32_t g_lastMqttAttemptMs = 0;
uint32_t g_mqttBackoffMs = 1000;
uint32_t g_lastReportedMs = 0;
uint32_t g_lastDurableHeartbeatMs = 0;
uint32_t g_wifiDisconnectedAtMs = 0;
uint32_t g_initialAppliedRevision = 0;
uint32_t g_initialHandledRevision = 0;
bool g_provisioning = false;
bool g_wifiWasConnected = false;
bool g_operational = false;
bool g_snapshotChanged = true;
bool g_hasSnapshot = false;

void configureTls(WiFiClientSecure& client) {
  client.setCACert(spp::config::kTlsRootCaBundle);
}

bool clockSynchronized() {
  return time(nullptr) >= 1700000000;
}

String isoTimestamp() {
  const time_t now = time(nullptr);
  if (now < 1700000000) return "1970-01-01T00:00:00Z";
  struct tm value {};
  gmtime_r(&now, &value);
  char result[24]{};
  strftime(result, sizeof(result), "%Y-%m-%dT%H:%M:%SZ", &value);
  return String(result);
}

bool commandExpired(const char* iso) {
  if (!clockSynchronized() || !iso || strlen(iso) < 20) return true;
  struct tm parsed {};
  if (!strptime(iso, "%Y-%m-%dT%H:%M:%SZ", &parsed)) return true;
  return time(nullptr) > mktime(&parsed);
}

String reportedPayload(const spp::PlaybackSnapshot& snapshot, bool online) {
  JsonDocument document;
  document["pianoId"] = spp::config::kPianoId;
  document["state"] = online ? spp::stateName(snapshot.state) : "offline";
  document["online"] = online;
  if (snapshot.sessionId[0] != '\0') document["sessionId"] = snapshot.sessionId;
  if (snapshot.songId[0] != '\0') document["songId"] = snapshot.songId;
  document["positionMs"] = snapshot.positionMs;
  document["durationMs"] = snapshot.durationMs;
  document["firmwareVersion"] = spp::config::kFirmwareVersion;
  document["profileId"] = "legacy-v1";
  document["lastAppliedRevision"] = snapshot.lastAppliedRevision;
  document["lastHandledRevision"] = snapshot.lastHandledRevision;
  if (snapshot.acknowledgementResult != spp::AcknowledgementResult::kNone) {
    document["acknowledgement"]["commandId"] = snapshot.acknowledgementCommandId;
    document["acknowledgement"]["revision"] = snapshot.acknowledgementRevision;
    document["acknowledgement"]["result"] = spp::acknowledgementName(snapshot.acknowledgementResult);
    if (snapshot.acknowledgementErrorCode[0] != '\0') {
      document["acknowledgement"]["error"]["code"] = snapshot.acknowledgementErrorCode;
      document["acknowledgement"]["error"]["message"] = snapshot.acknowledgementErrorMessage;
    }
  }
  if (snapshot.sessionOutcome != spp::SessionOutcome::kNone) {
    document["sessionOutcome"] = spp::sessionOutcomeName(snapshot.sessionOutcome);
  }
  if (snapshot.errorCode[0] != '\0') {
    document["error"]["code"] = snapshot.errorCode;
    document["error"]["message"] = snapshot.errorMessage;
  }
  document["reportedAt"] = isoTimestamp();
  String payload;
  serializeJson(document, payload);
  return payload;
}

void enqueueConnectivity(spp::DeviceState state) {
  PlaybackMessage message{};
  message.type = PlaybackMessageType::kConnectivity;
  message.connectivityState = state;
  xQueueSend(g_playbackQueue, &message, 0);
}

bool parseCommand(const String& payload, spp::DesiredCommand& command) {
  JsonDocument document;
  if (deserializeJson(document, payload) != DeserializationError::Ok) return false;
  if (strcmp(document["pianoId"] | "", spp::config::kPianoId) != 0) return false;
  command.type = spp::commandTypeFrom(document["type"] | "");
  command.revision = document["revision"] | 0;
  command.artifactBytes = document["artifactBytes"] | 0;
  strlcpy(command.commandId, document["commandId"] | "", sizeof(command.commandId));
  strlcpy(command.sessionId, document["sessionId"] | "", sizeof(command.sessionId));
  strlcpy(command.songId, document["songId"] | "", sizeof(command.songId));
  strlcpy(command.artifactId, document["artifactId"] | "", sizeof(command.artifactId));
  strlcpy(command.artifactSha256, document["artifactSha256"] | "", sizeof(command.artifactSha256));
  command.expired = commandExpired(document["expiresAt"] | "");
  if (command.type == spp::CommandType::kInvalid || command.revision == 0 ||
      strlen(command.commandId) != 36 || strlen(command.sessionId) != 36) return false;
  if (command.type == spp::CommandType::kPlay &&
      (strlen(command.songId) != 36 || strlen(command.artifactId) != 36 ||
       strlen(command.artifactSha256) != 64 || command.artifactBytes == 0)) return false;
  return true;
}

void onMqttMessage(String& topic, String& payload) {
  if (topic != g_desiredTopic || !g_playbackQueue) return;
  PlaybackMessage message{};
  message.type = PlaybackMessageType::kCommand;
  if (!parseCommand(payload, message.command)) return;
  if (xQueueSend(g_playbackQueue, &message, 0) != pdTRUE) g_mqtt.disconnect();
}

void publishReported() {
  if (!g_hasSnapshot || !g_mqtt.connected()) return;
  g_mqtt.publish(g_reportedTopic, reportedPayload(g_latestSnapshot, true), true, 1);
  g_lastReportedMs = millis();
}

void postDurableStatus() {
  if (!g_hasSnapshot || WiFi.status() != WL_CONNECTED || !clockSynchronized()) return;
  WiFiClientSecure client;
  configureTls(client);
  HTTPClient request;
  if (!request.begin(client, String(spp::config::kApiBaseUrl) + "/api/device/status")) return;
  request.addHeader("Authorization", String("Bearer ") + spp::config::kDeviceToken);
  request.addHeader("Content-Type", "application/json");
  request.setTimeout(2000);
  request.POST(reportedPayload(g_latestSnapshot, true));
  request.end();
  g_lastDurableHeartbeatMs = millis();
}

void startProvisioning() {
  if (g_provisioning) return;
  g_provisioning = true;
  g_operational = false;
  enqueueConnectivity(spp::DeviceState::kProvisioning);
  WiFi.setAutoReconnect(false);
  if (WiFi.status() == WL_CONNECTED) WiFi.disconnect(false, false);
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
  if (g_mqtt.connected() || WiFi.status() != WL_CONNECTED || !clockSynchronized()) return;
  if (millis() - g_lastMqttAttemptMs < g_mqttBackoffMs) return;
  g_lastMqttAttemptMs = millis();

  const String clientId = String("piano-") + spp::config::kPianoId;
  const String will = reportedPayload(g_latestSnapshot, false);
  g_mqtt.setWill(g_reportedTopic.c_str(), will.c_str(), true, 1);
  if (g_mqtt.connect(clientId.c_str(), spp::config::kMqttUsername,
                     spp::config::kMqttPassword)) {
    g_mqtt.subscribe(g_desiredTopic, 1);
    g_mqttBackoffMs = 1000;
    g_operational = true;
    enqueueConnectivity(spp::DeviceState::kIdle);
    publishReported();
    return;
  }
  g_mqttBackoffMs = min<uint32_t>(g_mqttBackoffMs * 2 + random(0, 500), 30000);
}

void handleConnectivity() {
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected) {
    if (!g_wifiWasConnected) {
      g_wifiWasConnected = true;
      if (g_provisioning) stopProvisioning();
    }
    connectMqtt();
    if (g_mqtt.connected()) {
      g_mqtt.loop();
    } else if (g_operational) {
      g_operational = false;
      enqueueConnectivity(spp::DeviceState::kConnecting);
    }
    return;
  }

  if (g_wifiWasConnected) {
    g_wifiWasConnected = false;
    g_wifiDisconnectedAtMs = millis();
    g_operational = false;
    if (!g_provisioning) enqueueConnectivity(spp::DeviceState::kConnecting);
  }
  if (!g_provisioning && millis() - g_wifiDisconnectedAtMs >= spp::config::kWifiProvisionTimeoutMs) {
    startProvisioning();
  }
}

void deliverArtifact(const spp::DesiredCommand& command) {
  PlaybackMessage message{};
  message.command = command;
  spp::Artifact* artifact = new (std::nothrow) spp::Artifact();
  if (!artifact) {
    message.type = PlaybackMessageType::kArtifactFailed;
    strlcpy(message.error, "Not enough RAM to prepare an artifact", sizeof(message.error));
    xQueueSend(g_playbackQueue, &message, portMAX_DELAY);
    return;
  }

  String error;
  if (!g_downloader.download(command.sessionId, command.artifactSha256,
                             command.artifactBytes, *artifact, error)) {
    delete artifact;
    message.type = PlaybackMessageType::kArtifactFailed;
    strlcpy(message.error, error.c_str(), sizeof(message.error));
  } else {
    message.type = PlaybackMessageType::kArtifactReady;
    message.artifact = artifact;
  }
  if (g_mqtt.connected()) g_mqtt.loop();
  xQueueSend(g_playbackQueue, &message, portMAX_DELAY);
}

void processNetworkActions() {
  NetworkAction action{};
  if (xQueueReceive(g_networkActionQueue, &action, 0) != pdTRUE) return;
  if (action.type == NetworkActionType::kEnterProvisioning) {
    startProvisioning();
    return;
  }
  deliverArtifact(action.command);
}

bool significantChange(const spp::PlaybackSnapshot& previous,
                       const spp::PlaybackSnapshot& next) {
  return previous.state != next.state ||
         previous.lastHandledRevision != next.lastHandledRevision ||
         previous.sessionOutcome != next.sessionOutcome ||
         strcmp(previous.sessionId, next.sessionId) != 0 ||
         strcmp(previous.errorCode, next.errorCode) != 0;
}

void handleSnapshots() {
  spp::PlaybackSnapshot snapshot{};
  while (xQueueReceive(g_snapshotQueue, &snapshot, 0) == pdTRUE) {
    g_snapshotChanged = g_snapshotChanged || !g_hasSnapshot || significantChange(g_latestSnapshot, snapshot);
    g_latestSnapshot = snapshot;
    g_hasSnapshot = true;
  }
}

void playbackTask(void*) {
  g_spi.begin();
  g_playback.begin(g_initialAppliedRevision, g_initialHandledRevision);
  uint32_t lastSnapshotMs = 0;
  while (true) {
    PlaybackMessage message{};
    while (xQueueReceive(g_playbackQueue, &message, 0) == pdTRUE) {
      if (message.type == PlaybackMessageType::kCommand) {
        const spp::CommandHandling handling = g_playback.handle(message.command);
        if (handling != spp::CommandHandling::kDuplicate) {
          const spp::PlaybackSnapshot snapshot = g_playback.snapshot();
          g_preferences.putULong("lastHandled", snapshot.lastHandledRevision);
          g_preferences.putULong("lastApplied", snapshot.lastAppliedRevision);
        }
        if (handling == spp::CommandHandling::kDownloadArtifact ||
            handling == spp::CommandHandling::kEnterProvisioning) {
          NetworkAction action{};
          action.type = handling == spp::CommandHandling::kDownloadArtifact
              ? NetworkActionType::kDownloadArtifact
              : NetworkActionType::kEnterProvisioning;
          action.command = message.command;
          xQueueSend(g_networkActionQueue, &action, pdMS_TO_TICKS(100));
        }
      } else if (message.type == PlaybackMessageType::kArtifactReady) {
        if (message.artifact) {
          g_playback.artifactReady(message.command, std::move(*message.artifact));
          delete message.artifact;
        }
      } else if (message.type == PlaybackMessageType::kArtifactFailed) {
        g_playback.artifactFailed(message.command, message.error);
      } else if (message.type == PlaybackMessageType::kConnectivity) {
        g_playback.setConnectivityState(message.connectivityState);
      }
    }

    g_playback.tick();
    const bool changed = g_playback.consumeDirty();
    if (changed || millis() - lastSnapshotMs >= 250) {
      const spp::PlaybackSnapshot snapshot = g_playback.snapshot();
      xQueueOverwrite(g_snapshotQueue, &snapshot);
      lastSnapshotMs = millis();
    }
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  randomSeed(esp_random());
  g_playbackQueue = xQueueCreate(8, sizeof(PlaybackMessage));
  g_networkActionQueue = xQueueCreate(4, sizeof(NetworkAction));
  g_snapshotQueue = xQueueCreate(1, sizeof(spp::PlaybackSnapshot));
  g_preferences.begin("piano", false);
  g_initialAppliedRevision = g_preferences.getULong("lastApplied", 0);
  g_initialHandledRevision = g_preferences.getULong("lastHandled", 0);
  g_desiredTopic = String(spp::config::kTopicPrefix) + "/" + spp::config::kPianoId + "/v1/desired";
  g_reportedTopic = String(spp::config::kTopicPrefix) + "/" + spp::config::kPianoId + "/v1/reported";

  configureTls(g_mqttTls);
  g_mqtt.begin(spp::config::kMqttHost, spp::config::kMqttPort, g_mqttTls);
  g_mqtt.onMessage(onMqttMessage);
  g_mqtt.setKeepAlive(20);
  g_mqtt.setTimeout(5000);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin();
  g_wifiDisconnectedAtMs = millis();
  setenv("TZ", "UTC0", 1);
  tzset();
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");

  xTaskCreatePinnedToCore(playbackTask, "piano-playback", 8192, nullptr, 3, nullptr, 1);
}

void loop() {
  handleSnapshots();
  handleConnectivity();
  processNetworkActions();

  if (g_snapshotChanged) {
    publishReported();
    postDurableStatus();
    g_snapshotChanged = false;
  }
  if (millis() - g_lastReportedMs >= spp::config::kReportedIntervalMs) publishReported();
  if (millis() - g_lastDurableHeartbeatMs >= spp::config::kDurableHeartbeatMs) postDurableStatus();
  delay(2);
}
