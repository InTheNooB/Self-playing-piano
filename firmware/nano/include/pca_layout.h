#pragma once

#include <stdint.h>

namespace spp::pca_layout {

constexpr uint8_t kFirstAddress = 0x41;
constexpr uint8_t kBoardCount = 5;
constexpr uint8_t kOutputsPerBoard = 16;
constexpr uint8_t kFirstPhysicalOutput = 16;

}  // namespace spp::pca_layout
