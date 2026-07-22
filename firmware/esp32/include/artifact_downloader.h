#pragma once

#include <Arduino.h>

#include "artifact.h"

namespace spp {

class ArtifactDownloader {
 public:
  bool download(const char* sessionId, const char* expectedSha256,
                size_t expectedBytes, Artifact& artifact, String& error);
};

}  // namespace spp
