#include "artifact.h"

#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>
#include <new>

#include "config.h"

namespace spp {

uint32_t Artifact::readUint32(const uint8_t* bytes) {
  return static_cast<uint32_t>(bytes[0]) |
         (static_cast<uint32_t>(bytes[1]) << 8) |
         (static_cast<uint32_t>(bytes[2]) << 16) |
         (static_cast<uint32_t>(bytes[3]) << 24);
}

bool Artifact::adopt(std::unique_ptr<uint8_t[]> data, size_t size, String& error) {
  if (size < kHeaderSize || size > config::kMaxArtifactBytes) {
    error = "Artifact size is invalid";
    return false;
  }
  if (memcmp(data.get(), "SPP1", 4) != 0 || data[4] != 1 || data[6] != kRecordSize || data[7] != 0) {
    error = "Artifact format is unsupported";
    return false;
  }
  const uint32_t count = readUint32(data.get() + 8);
  if (kHeaderSize + static_cast<size_t>(count) * kRecordSize != size) {
    error = "Artifact record count is invalid";
    return false;
  }
  data_ = std::move(data);
  size_ = size;
  noteCount_ = count;
  durationMs_ = readUint32(data_.get() + 12);
  return true;
}

void Artifact::clear() {
  data_.reset();
  size_ = 0;
  noteCount_ = 0;
  durationMs_ = 0;
}

bool Artifact::noteAt(uint32_t index, ArtifactNote& note) const {
  if (!data_ || index >= noteCount_) return false;
  const uint8_t* record = data_.get() + kHeaderSize + index * kRecordSize;
  note.startMs = readUint32(record);
  note.durationMs = readUint32(record + 4);
  note.keyIndex = record[8];
  note.velocity = record[9];
  note.flags = record[10];
  return note.keyIndex < 88 && note.durationMs > 0;
}

static void configureTls(WiFiClientSecure& client) {
  if (strlen(config::kTlsRootCa) > 0) client.setCACert(config::kTlsRootCa);
  else client.setInsecure();
}

static String bytesToHex(const uint8_t* bytes, size_t length) {
  static const char* digits = "0123456789abcdef";
  String result;
  result.reserve(length * 2);
  for (size_t index = 0; index < length; ++index) {
    result += digits[bytes[index] >> 4];
    result += digits[bytes[index] & 0x0F];
  }
  return result;
}

bool ArtifactDownloader::download(const char* sessionId, const char* expectedSha256,
                                  size_t expectedBytes, Artifact& artifact,
                                  String& error) {
  WiFiClientSecure apiClient;
  configureTls(apiClient);
  HTTPClient api;
  const String endpoint = String(config::kApiBaseUrl) + "/api/device/sessions/" + sessionId + "/artifact";
  const char* headers[] = {"Location"};
  api.collectHeaders(headers, 1);
  if (!api.begin(apiClient, endpoint)) {
    error = "Unable to open artifact endpoint";
    return false;
  }
  api.addHeader("Authorization", String("Bearer ") + config::kDeviceToken);
  const int redirectCode = api.GET();
  const String downloadUrl = api.header("Location");
  api.end();
  if ((redirectCode != HTTP_CODE_TEMPORARY_REDIRECT && redirectCode != HTTP_CODE_FOUND) || downloadUrl.isEmpty()) {
    error = "Artifact endpoint rejected the session";
    return false;
  }

  WiFiClientSecure storageClient;
  configureTls(storageClient);
  HTTPClient request;
  if (!request.begin(storageClient, downloadUrl)) {
    error = "Unable to connect to object storage";
    return false;
  }
  const int responseCode = request.GET();
  const int contentLength = request.getSize();
  if (responseCode != HTTP_CODE_OK || contentLength <= 0 ||
      static_cast<size_t>(contentLength) > config::kMaxArtifactBytes ||
      (expectedBytes > 0 && static_cast<size_t>(contentLength) != expectedBytes)) {
    request.end();
    error = "Artifact download size or response is invalid";
    return false;
  }

  std::unique_ptr<uint8_t[]> data(new (std::nothrow) uint8_t[contentLength]);
  if (!data) {
    request.end();
    error = "Not enough RAM for this artifact";
    return false;
  }
  const size_t received = request.getStreamPtr()->readBytes(data.get(), contentLength);
  request.end();
  if (received != static_cast<size_t>(contentLength)) {
    error = "Artifact download was interrupted";
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
  return artifact.adopt(std::move(data), contentLength, error);
}

}  // namespace spp
