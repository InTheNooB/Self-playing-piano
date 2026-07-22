#pragma once

#include <Adafruit_PWMServoDriver.h>
#include <Arduino.h>

namespace spp {

class SolenoidDriver {
 public:
  bool begin();
  void allOff();
  bool setKey(uint8_t keyIndex, bool on, uint8_t velocity);
  bool ready() const { return ready_; }

 private:
  static constexpr uint8_t kDriverCount = 6;
  static constexpr uint8_t kOutputsPerDriver = 16;
  static constexpr uint16_t kFullPowerPwm = 4095;
  static constexpr uint8_t kOutputEnablePin = 4;

  Adafruit_PWMServoDriver drivers_[kDriverCount] = {
      Adafruit_PWMServoDriver(0x40), Adafruit_PWMServoDriver(0x41),
      Adafruit_PWMServoDriver(0x42), Adafruit_PWMServoDriver(0x43),
      Adafruit_PWMServoDriver(0x44), Adafruit_PWMServoDriver(0x45),
  };
  bool ready_ = false;

  bool addressPresent(uint8_t address);
  void setOutput(uint8_t output, uint16_t pwm);
  uint16_t activationPwm(uint8_t velocity) const;
};

}  // namespace spp
