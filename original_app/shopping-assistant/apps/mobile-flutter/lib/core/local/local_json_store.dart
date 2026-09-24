import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

class LocalJsonStore {
  const LocalJsonStore(this.fileName);

  final String fileName;

  Future<Map<String, dynamic>> read() async {
    final file = await _file();
    if (!await file.exists()) return const <String, dynamic>{};
    try {
      final content = await file.readAsString();
      final decoded = jsonDecode(content);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) {
        return decoded.map((key, value) => MapEntry(key.toString(), value));
      }
    } on FormatException {
      return const <String, dynamic>{};
    } on FileSystemException {
      return const <String, dynamic>{};
    }
    return const <String, dynamic>{};
  }

  Future<void> write(Map<String, dynamic> value) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    const encoder = JsonEncoder.withIndent('  ');
    await file.writeAsString(encoder.convert(value), flush: true);
  }

  Future<File> _file() async {
    final directory = await getApplicationDocumentsDirectory();
    return File('${directory.path}/$fileName');
  }
}
