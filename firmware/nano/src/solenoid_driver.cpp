#include "solenoid_driver.h"

#include <Wire.h>

#include "note_mapping.h"

namespace spp {

bool SolenoidDriver::addressPresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool SolenoidDriver::begin() {
  pinMode(kOutputEnablePin, OUTPUT);
  digitalWrite(kOutputEnablePin, HIGH);
  Wire.begin();
  Wire.setClock(100000);

  for (uint8_t index = 0; index < kDriverCount; ++index) {
    if (!addressPresent(0x40 + index)) return false;
  }
  for (auto& driver : drivers_) {
    if (!driver.begin()) return false;
    driver.setOutputMode(true);
    driver.setPWMFreq(100);
  }

  allOff();
  ready_ = true;
  digitalWrite(kOutputEnablePin, LOW);
  return true;
}

void SolenoidDriver::setOutput(uint8_t output, uint16_t pwm) {
  if (output >= kDriverCount * kOutputsPerDriver) return;
  const uint8_t driverIndex = output / kOutputsPerDriver;
  const uint8_t channel = 15 - (output % kOutputsPerDriver);
  drivers_[driverIndex].setPWM(channel, 0, pwm);
}

uint16_t SolenoidDriver::activationPwm(uint8_t velocity) const {
  (void)velocity;
  return kFullPowerPwm;
}

bool SolenoidDriver::setKey(uint8_t keyIndex, bool on, uint8_t velocity) {
  if (!ready_) return false;
  const uint8_t output = outputForKey(keyIndex);
  if (output == kUnmappedOutput) return false;
  setOutput(output, on ? activationPwm(velocity) : 0);
  return true;
}

void SolenoidDriver::allOff() {
  for (uint8_t output = 0; output < kDriverCount * kOutputsPerDriver; ++output) {
    setOutput(output, 0);
  }
}

}  // namespace spp
