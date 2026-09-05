import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class DeviceIdentity {
  const DeviceIdentity({
    required this.deviceId,
    required this.email,
    required this.password,
  });

  final String deviceId;
  final String email;
  final String password;
}

class DeviceIdentityStore {
  const DeviceIdentityStore({
    FlutterSecureStorage storage = const FlutterSecureStorage(),
  }) : _storage = storage;

  static const _deviceIdKey = 'shopping_assistant_device_id_v1';
  static const _passwordKey = 'shopping_assistant_device_password_v1';
  final FlutterSecureStorage _storage;

  Future<DeviceIdentity> getOrCreate() async {
    var deviceId = await _storage.read(key: _deviceIdKey);
    var password = await _storage.read(key: _passwordKey);
    if (deviceId == null || deviceId.isEmpty) {
      deviceId = _randomUuidV4();
      await _storage.write(key: _deviceIdKey, value: deviceId);
    }
    if (password == null || password.isEmpty) {
      password = _randomHex(32);
      await _storage.write(key: _passwordKey, value: password);
    }
    return DeviceIdentity(
      deviceId: deviceId,
      email: 'mobile-$deviceId@shopping-assistant.local',
      password: password,
    );
  }

  String _randomHex(int byteLength) {
    final random = Random.secure();
    return List.generate(
      byteLength,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  String _randomUuidV4() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-'
        '${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-'
        '${hex.substring(16, 20)}-'
        '${hex.substring(20)}';
  }
}
