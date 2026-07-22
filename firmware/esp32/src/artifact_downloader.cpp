#include "artifact_downloader.h"

#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>
#include <new>

#include "config.h"

namespace spp {

namespace {

constexpr uint32_t kHttpTimeoutMs = 15000;

void configureTls(WiFiClientSecure& client) {
  client.setCACert(config::kTlsRootCaBundle);
}

bool resolveDownloadUrl(const char* sessionId, String& downloadUrl,
                        String& error) {
  WiFiClientSecure client;
  configureTls(client);
  HTTPClient request;
  const String endpoint = String(config::kApiBaseUrl) +
                          "/api/device/sessions/" + sessionId + "/artifact";
  const char* headers[] = {"Location"};
  request.collectHeaders(headers, 1);
  if (!request.begin(client, endpoint)) {
    error = "Unable to open artifact endpoint";
    return false;
  }
  request.addHeader("Authorization", String("Bearer ") + config::kDeviceToken);
  request.setTimeout(kHttpTimeoutMs);
  const int responseCode = request.GET();
  downloadUrl = request.header("Location");
  request.end();
  if ((responseCode == HTTP_CODE_TEMPORARY_REDIRECT ||
       responseCode == HTTP_CODE_FOUND) && !downloadUrl.isEmpty()) {
    return true;
  }
  if (responseCode < 0) {
    error = "Artifact endpoint connection failed: " +
            HTTPClient::errorToString(responseCode);
    return false;
  }
  error = "Artifact endpoint returned HTTP " + String(responseCode) +
          " without a download location";
  return false;
}

String bytesToHex(const uint8_t* bytes, size_t length) {
  static const char* digits = "0123456789abcdef";
  String result;
  result.reserve(length * 2);
  for (size_t index = 0; index < length; ++index) {
    result += digits[bytes[index] >> 4];
    result += digits[bytes[index] & 0x0F];
  }
  return result;
}

}  // namespace

bool ArtifactDownloader::download(const char* sessionId,
                                  const char* expectedSha256,
                                  size_t expectedBytes, Artifact& artifact,
                                  String& error) {
  String downloadUrl;
  if (!resolveDownloadUrl(sessionId, downloadUrl, error)) return false;

  WiFiClientSecure storageClient;
  configureTls(storageClient);
  HTTPClient request;
  if (!request.begin(storageClient, downloadUrl)) {
    error = "Unable to connect to object storage";
    return false;
  }
  request.setTimeout(kHttpTimeoutMs);
  const int responseCode = request.GET();
  const int contentLength = request.getSize();
  if (responseCode < 0) {
    request.end();
    error = "Artifact storage connection failed: " +
            HTTPClient::errorToString(responseCode);
    return false;
  }
  if (responseCode != HTTP_CODE_OK || contentLength <= 0 ||
      static_cast<size_t>(contentLength) > config::kMaxArtifactBytes ||
      (expectedBytes > 0 &&
       static_cast<size_t>(contentLength) != expectedBytes)) {
    request.end();
    error = "Artifact download returned HTTP " + String(responseCode) +
            " with " + String(contentLength) + " bytes; expected " +
            String(expectedBytes);
    return false;
  }

  std::unique_ptr<uint8_t[]> data(new (std::nothrow) uint8_t[contentLength]);
  if (!data) {
    request.end();
    error = "Not enough RAM for this artifact";
    return false;
  }
  const size_t received =
      request.getStreamPtr()->readBytes(data.get(), contentLength);
  request.end();
  if (received != static_cast<size_t>(contentLength)) {
    error = "Artifact download stopped after " + String(received) + " of " +
            String(contentLength) + " bytes";
    return false;
  }

  uint8_t digest[32]{};
  mbedtls_sha256_context context;
  mbedtls_sha256_init(&context);
  mbedtls_sha256_starts_ret(&context, 0);
  mbedtls_sha256_update_ret(&context, data.get(), contentLength);
  mbedtls_sha256_finish_ret(&context, digest);
  mbedtls_sha256_free(&context);
  if (!bytesToHex(digest, sizeof(digest)).equalsIgnoreCase(expectedSha256)) {
    error = "Artifact checksum does not match the command";
    return false;
  }

  ArtifactError validationError = ArtifactError::kNone;
  if (artifact.adopt(std::move(data), contentLength, validationError)) {
    return true;
  }
  error = artifactErrorMessage(validationError);
  return false;
}

}  // namespace spp
