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
  Wire.setWireTimeout(5000, true);
  Wire.setClock(100000);

  for (uint8_t index = 0; index < kDriverCount; ++index) {
    if (!addressPresent(0x40 + index)) return false;
  }
  for (auto& driver : drivers_) {
    if (!driver.begin()) return false;
    driver.setOutputMode(true);
    driver.setPWMFreq(100);
  }

  ready_ = true;
  if (!allOff()) return false;
  return true;
}

bool SolenoidDriver::setOutput(uint8_t output, uint16_t pwm) {
  if (output >= kDriverCount * kOutputsPerDriver) return false;
  const uint8_t driverIndex = output / kOutputsPerDriver;
  const uint8_t channel = 15 - (output % kOutputsPerDriver);
  drivers_[driverIndex].setPWM(channel, 0, pwm);
  if (!Wire.getWireTimeoutFlag()) return true;
  Wire.clearWireTimeoutFlag();
  ready_ = false;
  digitalWrite(kOutputEnablePin, HIGH);
  return false;
}

uint16_t SolenoidDriver::activationPwm(uint8_t velocity) const {
  (void)velocity;
  return kFullPowerPwm;
}

bool SolenoidDriver::setKey(uint8_t keyIndex, bool on, uint8_t velocity) {
  if (!ready_) return false;
  const uint8_t output = outputForKey(keyIndex);
  if (output == kUnmappedOutput) return false;
  return setOutput(output, on ? activationPwm(velocity) : 0);
}

bool SolenoidDriver::clearDriver(uint8_t address) {
  Wire.clearWireTimeoutFlag();
  Wire.beginTransmission(address);
  Wire.write(0xFA);
  Wire.write(0x00);
  Wire.write(0x00);
  Wire.write(0x00);
  Wire.write(0x10);
  const bool success = Wire.endTransmission() == 0 && !Wire.getWireTimeoutFlag();
  Wire.clearWireTimeoutFlag();
  return success;
}

bool SolenoidDriver::allOff() {
  digitalWrite(kOutputEnablePin, HIGH);
  bool cleared = true;
  for (uint8_t index = 0; index < kDriverCount; ++index) {
    if (!clearDriver(0x40 + index)) cleared = false;
  }
  if (!cleared) ready_ = false;
  if (ready_) digitalWrite(kOutputEnablePin, LOW);
  return cleared;
}

}  // namespace spp
