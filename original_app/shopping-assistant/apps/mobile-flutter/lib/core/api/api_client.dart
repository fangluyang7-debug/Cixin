import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../services/device_identity_store.dart';

enum ProductSearchPipelineMode {
  currentAnnThenRefine('current_ann_then_refine'),
  lightTagAnnFusion('light_tag_ann_fusion');

  const ProductSearchPipelineMode(this.apiValue);

  final String apiValue;

  static ProductSearchPipelineMode fromApiValue(String? value) {
    return value == currentAnnThenRefine.apiValue
        ? currentAnnThenRefine
        : lightTagAnnFusion;
  }
}

class ShoppingApiClient {
  ShoppingApiClient({
    required this.baseUrl,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 60),
    this.enableAutoAuth = true,
    DeviceIdentityStore deviceIdentityStore = const DeviceIdentityStore(),
  })  : _httpClient = httpClient ?? http.Client(),
        _deviceIdentityStore = deviceIdentityStore;

  final String baseUrl;
  final Duration timeout;
  final bool enableAutoAuth;
  final http.Client _httpClient;
  final DeviceIdentityStore _deviceIdentityStore;
  String? _accessToken;
  Future<String?>? _pendingAuth;

  Uri endpoint(String path) {
    final normalizedBase = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$normalizedBase$normalizedPath');
  }

  Future<ImageAssetResponse> uploadImage({
    required File imageFile,
    required String sourceType,
  }) async {
    final headers = await _authHeaders();
    final request = http.MultipartRequest(
      'POST',
      endpoint('/api/v1/assets/images'),
    )
      ..headers.addAll(headers)
      ..fields['variantType'] = 'compressed_recognition'
      ..fields['isPrimaryRecognitionAsset'] = 'true'
      ..fields['sourceType'] = sourceType
      ..files.add(
        await http.MultipartFile.fromPath(
          'file',
          imageFile.path,
          contentType: _imageContentType(imageFile.path),
        ),
      );

    final streamed = await _httpClient.send(request).timeout(timeout);
    final response = await http.Response.fromStream(streamed);
    final data = _decodeData(response);
    return ImageAssetResponse.fromJson(data);
  }

  Future<CreateSessionResponse> createSession({
    required String assetId,
    ApiSubjectSelection? initialSubjectSelection,
    Map<String, dynamic>? filters,
  }) async {
    final body = <String, dynamic>{
      'assetId': assetId,
      'entrySource': 'android_app',
      'categoryHint': 'general',
      if (filters != null && filters.isNotEmpty) 'filters': filters,
      if (initialSubjectSelection != null)
        'initialSubjectSelection': initialSubjectSelection.toJson(
          selectionSource: 'user_initial',
        ),
    };
    final data = await _postJson('/api/v1/sessions', body);
    return CreateSessionResponse.fromJson(data);
  }

  Future<CreateSessionResponse> createTextSession({
    required String message,
    Map<String, dynamic>? filters,
  }) async {
    final data = await _postJson('/api/v1/sessions/text', {
      'message': message,
      'entrySource': 'android_app',
      if (filters != null && filters.isNotEmpty) 'filters': filters,
    });
    return CreateSessionResponse.fromJson(data);
  }

  Future<CandidateListResponse> getCandidates(String sessionId) async {
    final response = await _httpClient
        .get(
          endpoint('/api/v1/sessions/$sessionId/candidates'),
          headers: await _authHeaders(),
        )
        .timeout(timeout);
    return CandidateListResponse.fromJson(_decodeData(response));
  }

  Future<void> updateSubjectSelection({
    required String sessionId,
    required double left,
    required double top,
    required double width,
    required double height,
    String? assetId,
  }) async {
    final body = <String, dynamic>{
      if (assetId != null && assetId.isNotEmpty) 'assetId': assetId,
      'selectionSource': 'user_adjusted',
      'box': {
        'x': left,
        'y': top,
        'width': width,
        'height': height,
        'confidence': 1,
        'label': 'user_selected_subject',
      },
    };
    await _postJson('/api/v1/sessions/$sessionId/subject-selection', body);
  }

  Future<RefineCandidatesResponse> refineCandidates(String sessionId) async {
    final data = await _postJson(
      '/api/v1/sessions/$sessionId/candidates/refine',
      <String, dynamic>{},
    );
    return RefineCandidatesResponse.fromJson(data);
  }

  Future<CreateSessionResponse> updateProductProfile({
    required String sessionId,
    required BackendProductProfile profile,
    Map<String, dynamic>? filters,
  }) async {
    final body = profile.toPatchJson();
    if (filters != null && filters.isNotEmpty) {
      body['filters'] = filters;
    }
    final data = await _patchJson(
      '/api/v1/sessions/$sessionId/profile',
      body,
    );
    return CreateSessionResponse.fromJson(data);
  }

  Future<CandidateListResponse> getMoreCandidates({
    required String sessionId,
    String? cursor,
    int limit = 30,
  }) async {
    final body = <String, dynamic>{'limit': limit};
    if (cursor != null && cursor.isNotEmpty) body['cursor'] = cursor;
    final data = await _postJson(
      '/api/v1/sessions/$sessionId/candidates/more',
      body,
    );
    return CandidateListResponse.fromJson(data);
  }

  Future<Map<String, dynamic>> getCandidateDetail(String candidateItemId) {
    return _getJson('/api/v1/candidates/$candidateItemId');
  }

  Future<CandidateListResponse> getSessionCart(String sessionId) async {
    final data = await _getJson('/api/v1/sessions/$sessionId/cart');
    return CandidateListResponse.fromJson(data);
  }

  Future<Map<String, dynamic>> shortlistCandidate({
    required String sessionId,
    required String candidateItemId,
    String source = 'mobile_left_swipe',
    int limit = 4,
  }) {
    return _postJson(
      '/api/v1/sessions/$sessionId/candidates/$candidateItemId/shortlist',
      {
        'source': source,
        'limit': limit,
      },
    );
  }

  Future<Map<String, dynamic>> removeCartCandidate({
    required String sessionId,
    required String candidateItemId,
  }) {
    return _deleteJson('/api/v1/sessions/$sessionId/cart/$candidateItemId');
  }

  Future<Map<String, dynamic>> getTrendOutfitRecommendations({
    required String sessionId,
    required String candidateItemId,
    int limit = 4,
  }) {
    return _postJson(
      '/api/v1/recommendations/trend-outfit',
      {
        'sessionId': sessionId,
        'candidateItemId': candidateItemId,
        'limit': limit,
      },
    );
  }

  Future<SuggestionListResponse> getSuggestions(String sessionId) async {
    final data = await _getJson('/api/v1/sessions/$sessionId/suggestions');
    return SuggestionListResponse.fromJson(data);
  }

  Future<UserProfileResponse> getUserProfile() async {
    final data = await _getJson('/api/v1/users/me/profile');
    return UserProfileResponse.fromJson(data);
  }

  Future<UserProfileBlock> createUserProfileBlock({
    required String blockType,
    required String scope,
    required Map<String, dynamic> payload,
    String source = 'user_edit',
    double confidence = 1,
    String? sensitivity,
  }) async {
    final data = await _postJson('/api/v1/users/me/profile/blocks', {
      'blockType': blockType,
      'scope': scope,
      'payload': payload,
      'source': source,
      'confidence': confidence,
      if (sensitivity != null) 'sensitivity': sensitivity,
    });
    return UserProfileBlock.fromJson(data);
  }

  Future<UserProfileBlock> updateUserProfileBlock({
    required String blockId,
    required String blockType,
    required String scope,
    required Map<String, dynamic> payload,
    String? sensitivity,
  }) async {
    final data = await _patchJson('/api/v1/users/me/profile/blocks/$blockId', {
      'blockType': blockType,
      'scope': scope,
      'payload': payload,
      if (sensitivity != null) 'sensitivity': sensitivity,
    });
    return UserProfileBlock.fromJson(data);
  }

  Future<void> deleteUserProfileBlock(String blockId) async {
    await _deleteJson('/api/v1/users/me/profile/blocks/$blockId');
  }

  Future<String?> getShoeSizePreference({String? deviceId}) async {
    final resolvedDeviceId =
        deviceId ?? (await _deviceIdentityStore.getOrCreate()).deviceId;
    final data =
        await _getJson('/api/v1/preferences/shoe-size?deviceId=$resolvedDeviceId');
    final shoeSize = data['shoeSize'];
    return shoeSize?.toString();
  }

  Future<void> saveShoeSizePreference({
    required String shoeSize,
    String? deviceId,
  }) async {
    final resolvedDeviceId =
        deviceId ?? (await _deviceIdentityStore.getOrCreate()).deviceId;
    await _postJson('/api/v1/preferences/shoe-size', {
      'deviceId': resolvedDeviceId,
      'shoeSize': shoeSize,
    });
  }

  Future<TurnSubmitResponse> submitTurn({
    required String sessionId,
    required String message,
    Map<String, dynamic>? filters,
  }) async {
    final body = <String, dynamic>{
      'message': message,
      if (filters != null && filters.isNotEmpty) 'filters': filters,
    };
    final data = await _postJson('/api/v1/sessions/$sessionId/turns', body);
    return TurnSubmitResponse.fromJson(data);
  }

  Future<List<BackendCandidateItem>> searchShoesByText(String text) async {
    final keywords = text
        .split(RegExp(r'[\s,，。；;]+'))
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty)
        .toList(growable: false);

    if (keywords.isEmpty) return [];

    final data = await _postJson('/api/v1/search/shoes', {
      'keywords': keywords,
      'filters': _filtersFromText(text),
    });
    final candidates = _asList(data['candidates']);
    return [
      for (var index = 0; index < candidates.length; index += 1)
        BackendCandidateItem.fromJson(_asMap(candidates[index]), index),
    ];
  }

  Future<Map<String, dynamic>> _postJson(
    String path,
    Map<String, dynamic> body,
  ) async {
    final headers = await _jsonHeaders();
    final response = await _httpClient
        .post(
          endpoint(path),
          headers: headers,
          body: jsonEncode(body),
        )
        .timeout(timeout);
    return _decodeData(response);
  }

  Future<Map<String, dynamic>> _patchJson(
    String path,
    Map<String, dynamic> body,
  ) async {
    final headers = await _jsonHeaders();
    final response = await _httpClient
        .patch(
          endpoint(path),
          headers: headers,
          body: jsonEncode(body),
        )
        .timeout(timeout);
    return _decodeData(response);
  }

  Future<Map<String, dynamic>> _getJson(String path) async {
    final response = await _httpClient
        .get(endpoint(path), headers: await _authHeaders())
        .timeout(timeout);
    return _decodeData(response);
  }

  Future<Map<String, dynamic>> _deleteJson(String path) async {
    final response = await _httpClient
        .delete(endpoint(path), headers: await _authHeaders())
        .timeout(timeout);
    return _decodeData(response);
  }

  Future<Map<String, String>> _jsonHeaders() async {
    return {
      'Content-Type': 'application/json',
      ...await _authHeaders(),
    };
  }

  Future<Map<String, String>> _authHeaders() async {
    final token = await _ensureAuthToken();
    if (token == null || token.isEmpty) return const {};
    return {'Authorization': 'Bearer $token'};
  }

  Future<String?> _ensureAuthToken() async {
    if (!enableAutoAuth) return null;
    final cached = _accessToken;
    if (cached != null && cached.isNotEmpty) return cached;

    final pending = _pendingAuth;
    if (pending != null) return pending;

    final authFuture = _loginOrRegisterDeviceUser();
    _pendingAuth = authFuture;
    try {
      _accessToken = await authFuture;
      return _accessToken;
    } finally {
      _pendingAuth = null;
    }
  }

  Future<String?> _loginOrRegisterDeviceUser() async {
    final identity = await _deviceIdentityStore.getOrCreate();
    try {
      return _tokenFromAuthResponse(
        await _postJsonWithoutAuth('/api/v1/auth/login', {
          'email': identity.email,
          'password': identity.password,
        }),
      );
    } on ShoppingApiException catch (error) {
      if (error.code != 'AUTH_INVALID_CREDENTIALS') rethrow;
    }

    try {
      return _tokenFromAuthResponse(
        await _postJsonWithoutAuth('/api/v1/auth/register', {
          'email': identity.email,
          'password': identity.password,
          'displayName': 'Mobile Device User',
        }),
      );
    } on ShoppingApiException catch (error) {
      if (error.code != 'AUTH_EMAIL_ALREADY_REGISTERED') rethrow;
      return _tokenFromAuthResponse(
        await _postJsonWithoutAuth('/api/v1/auth/login', {
          'email': identity.email,
          'password': identity.password,
        }),
      );
    }
  }

  Future<Map<String, dynamic>> _postJsonWithoutAuth(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await _httpClient
        .post(
          endpoint(path),
          headers: const {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        )
        .timeout(timeout);
    return _decodeData(response);
  }

  String? _tokenFromAuthResponse(Map<String, dynamic> data) {
    final token = data['accessToken']?.toString();
    return token == null || token.isEmpty ? null : token;
  }

  Map<String, dynamic> _decodeData(http.Response response) {
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded['error'];
      final code = error is Map ? error['code'] : null;
      throw ShoppingApiException(
        code: code?.toString() ?? 'HTTP_${response.statusCode}',
        message: response.body,
      );
    }
    final success = decoded['success'];
    if (success == false) {
      final error = decoded['error'];
      throw ShoppingApiException(
        code: error is Map
            ? error['code']?.toString() ?? 'API_ERROR'
            : 'API_ERROR',
        message: error is Map
            ? error['message']?.toString() ?? response.body
            : response.body,
      );
    }
    return _asMap(decoded['data']);
  }

  static Map<String, dynamic> _filtersFromText(String text) {
    final filters = <String, dynamic>{};
    final priceMax = _extractPriceMax(text);
    if (priceMax != null) filters['priceMax'] = priceMax;
    if (text.contains('有货') || text.contains('现货')) filters['stockOnly'] = true;
    if (text.contains('最低') || text.contains('低价') || text.contains('便宜')) {
      filters['sortRule'] = 'price_asc';
    }
    final platformFilter = _extractPlatformFilter(text);
    if (platformFilter != null) {
      filters[platformFilter.key] = platformFilter.value;
    }
    return filters;
  }

  static String? _extractPriceMax(String text) {
    final explicitCurrency = RegExp(
      r'(?:预算|价格|价位|不超过|低于|少于|控制在|最多|最高)?\s*(\d{2,5})\s*(?:元|块|rmb|RMB|¥)',
    ).firstMatch(text);
    if (explicitCurrency != null) return explicitCurrency.group(1);

    final explicitBudget = RegExp(
      r'(?:预算|价格|价位|不超过|低于|少于|控制在|最多|最高)\D{0,8}(\d{2,5})',
    ).firstMatch(text);
    if (explicitBudget != null) return explicitBudget.group(1);

    final rangeLimit = RegExp(r'(\d{3,5})\s*(?:以内|以下|内)').firstMatch(text);
    return rangeLimit?.group(1);
  }

  static MapEntry<String, List<String>>? _extractPlatformFilter(String text) {
    final platforms = <String>{
      if (RegExp(r'淘宝|淘保|掏宝|tao\s*bao|taobao|\btb\b', caseSensitive: false)
          .hasMatch(text))
        'taobao',
      if (RegExp(r'天猫|添猫|tmall|t\s*mall|\btm\b', caseSensitive: false)
          .hasMatch(text))
        'tmall',
      if (RegExp(r'京东|京冬|jing\s*dong|jingdong|\bjd\b', caseSensitive: false)
          .hasMatch(text))
        'jd',
      if (RegExp(r'得物|得务|毒\s*(?:app)?|de\s*wu|dewu', caseSensitive: false)
          .hasMatch(text))
        'dewu',
      if (RegExp(r'拼多多|拼夕夕|拼多|p\s*dd|pdd|pin\s*duo\s*duo', caseSensitive: false)
          .hasMatch(text))
        'pdd',
      if (RegExp(r'抖音|抖荫|dou\s*yin|douyin|\bdy\b|tik\s*tok|tiktok',
              caseSensitive: false)
          .hasMatch(text))
        'douyin',
      if (RegExp(r'闲鱼|咸鱼|鲜鱼|先鱼|xian\s*yu|xianyu', caseSensitive: false)
          .hasMatch(text))
        'xianyu',
    };
    if (platforms.isEmpty) return null;

    final excludes = RegExp(
      r'不看|别看|不要|别要|排除|去掉|剔除|过滤掉|屏蔽|exclude|remove|without|not\s+(?:show|see|include)|no\s+',
      caseSensitive: false,
    ).hasMatch(text);
    return MapEntry(
      excludes ? 'platformsExclude' : 'platformsInclude',
      platforms.toList(growable: false),
    );
  }
}

class ShoppingApiException implements Exception {
  ShoppingApiException({required this.code, required this.message});

  final String code;
  final String message;

  @override
  String toString() => '$code: $message';
}

class ImageAssetResponse {
  const ImageAssetResponse({
    required this.assetId,
    required this.assetGroupId,
  });

  final String assetId;
  final String assetGroupId;

  factory ImageAssetResponse.fromJson(Map<String, dynamic> json) {
    return ImageAssetResponse(
      assetId: json['assetId']?.toString() ?? '',
      assetGroupId: json['assetGroupId']?.toString() ?? '',
    );
  }
}

class ApiSubjectSelection {
  const ApiSubjectSelection({
    required this.left,
    required this.top,
    required this.width,
    required this.height,
  });

  final double left;
  final double top;
  final double width;
  final double height;

  Map<String, dynamic> toJson({required String selectionSource}) => {
        'selectionSource': selectionSource,
        'box': {
          'x': left,
          'y': top,
          'width': width,
          'height': height,
          'confidence': 1,
          'label': 'user_selected_subject',
        },
      };
}

class CreateSessionResponse {
  const CreateSessionResponse({
    required this.sessionId,
    required this.searchPipelineMode,
    this.assistantMessage,
    this.intent,
    this.productProfile,
    this.detailedProfileStatus,
    this.stateChangingTurn = true,
  });

  final String sessionId;
  final ProductSearchPipelineMode searchPipelineMode;
  final String? assistantMessage;
  final String? intent;
  final BackendProductProfile? productProfile;
  final String? detailedProfileStatus;
  final bool stateChangingTurn;

  factory CreateSessionResponse.fromJson(Map<String, dynamic> json) {
    final session = _asMap(json['session']);
    final textQuery = _asMap(json['textQuery']);
    final conversationState = _asMap(json['conversationState']);
    final activeFilter = _asMap(json['activeFilter']);
    final activeFilterRaw = _asMap(activeFilter['raw']);
    final imageSearch = _asMap(json['imageSearch']);
    final modeValue = activeFilter['searchPipelineMode']?.toString() ??
        activeFilterRaw['searchPipelineMode']?.toString() ??
        imageSearch['searchPipelineMode']?.toString();
    final stateChangingTurn = conversationState['stateChangingTurn'] ??
        textQuery['stateChangingTurn'];
    final profileJson = _asMap(json['productProfile']);
    return CreateSessionResponse(
      sessionId: session['sessionId']?.toString() ?? '',
      searchPipelineMode: ProductSearchPipelineMode.fromApiValue(modeValue),
      assistantMessage: json['assistantMessage']?.toString(),
      intent: json['intent']?.toString() ?? textQuery['intent']?.toString(),
      productProfile: profileJson.isEmpty
          ? null
          : BackendProductProfile.fromJson(profileJson),
      detailedProfileStatus:
          _nullableString(imageSearch['detailedProfileStatus']),
      stateChangingTurn: stateChangingTurn is bool ? stateChangingTurn : true,
    );
  }
}

class BackendProductProfile {
  const BackendProductProfile({
    required this.category,
    this.brand,
    this.modelLine,
    this.colorFamily,
    this.colorway,
    this.shoeType,
    this.size,
    this.color,
    this.styleTags = const [],
    this.sceneTags = const [],
    this.keywords = const [],
    this.confidence,
  });

  final String category;
  final String? brand;
  final String? modelLine;
  final String? colorFamily;
  final String? colorway;
  final String? shoeType;
  final String? size;
  final String? color;
  final List<String> styleTags;
  final List<String> sceneTags;
  final List<String> keywords;
  final double? confidence;

  factory BackendProductProfile.fromJson(Map<String, dynamic> json) {
    return BackendProductProfile(
      category: _nullableString(json['category']) ?? 'shoe',
      brand: _nullableString(json['brand']),
      modelLine: _nullableString(json['modelLine']),
      colorFamily: _nullableString(json['colorFamily']),
      colorway: _nullableString(json['colorway']),
      shoeType: _nullableString(json['shoeType']),
      size: _nullableString(json['size']),
      color: _nullableString(json['color']),
      styleTags: _stringList(json['styleTags']),
      sceneTags: _stringList(json['sceneTags']),
      keywords: _stringList(json['keywords']),
      confidence: json['confidence'] is num
          ? (json['confidence'] as num).toDouble()
          : double.tryParse(json['confidence']?.toString() ?? ''),
    );
  }

  BackendProductProfile copyWith({
    String? category,
    Object? brand = _profileSentinel,
    Object? modelLine = _profileSentinel,
    Object? colorFamily = _profileSentinel,
    Object? colorway = _profileSentinel,
    Object? shoeType = _profileSentinel,
    Object? size = _profileSentinel,
    Object? color = _profileSentinel,
    List<String>? styleTags,
    List<String>? sceneTags,
    List<String>? keywords,
    double? confidence,
  }) {
    String? stringValue(Object? value, String? fallback) =>
        identical(value, _profileSentinel) ? fallback : _nullableString(value);

    return BackendProductProfile(
      category: category ?? this.category,
      brand: stringValue(brand, this.brand),
      modelLine: stringValue(modelLine, this.modelLine),
      colorFamily: stringValue(colorFamily, this.colorFamily),
      colorway: stringValue(colorway, this.colorway),
      shoeType: stringValue(shoeType, this.shoeType),
      size: stringValue(size, this.size),
      color: stringValue(color, this.color),
      styleTags: styleTags ?? this.styleTags,
      sceneTags: sceneTags ?? this.sceneTags,
      keywords: keywords ?? this.keywords,
      confidence: confidence ?? this.confidence,
    );
  }

  Map<String, dynamic> toPatchJson() => {
        'category': category,
        'brand': brand,
        'modelLine': modelLine,
        'colorFamily': colorFamily,
        'colorway': colorway,
        'shoeType': shoeType,
        'size': size,
        'color': color,
        'styleTags': styleTags,
        'sceneTags': sceneTags,
        'keywords': keywords,
        if (confidence != null) 'confidence': confidence,
      };

  List<String> get searchTags {
    final colorTag = _firstNonBlank([color, colorway, colorFamily]);
    final typeTag = category == 'shoe'
        ? _firstNonBlank([shoeType])
        : _firstNonBlank([modelLine, category]);
    final tags = <String>[
      if (brand != null) _displayBrand(brand!),
      if (colorTag != null) _displayColor(colorTag),
      if (typeTag != null)
        category == 'shoe'
            ? _displayShoeType(typeTag)
            : _displayCategory(typeTag),
    ];
    final displayTags = tags
        .where((item) =>
            item.trim().isNotEmpty && item.trim().toLowerCase() != 'general')
        .toList(growable: false);
    final keywordTags = keywords.map(_displayCategory);
    return [
      ...{
        for (final item in displayTags.isEmpty ? keywordTags : displayTags)
          if (item.trim().isNotEmpty && item.trim().toLowerCase() != 'general')
            item.trim(),
      },
    ];
  }

  static String? _firstNonBlank(List<String?> values) {
    for (final value in values) {
      final trimmed = value?.trim();
      if (trimmed != null && trimmed.isNotEmpty) return trimmed;
    }
    return null;
  }

  static String _displayBrand(String value) {
    final token = _compact(value);
    const aliases = {
      'puma': '彪马',
      'nike': '耐克',
      'adidas': '阿迪达斯',
      'jordan': '乔丹',
      'converse': '匡威',
      'vans': '万斯',
      'newbalance': '新百伦',
      'nb': '新百伦',
      'lining': '李宁',
      'anta': '安踏',
      'xtep': '特步',
    };
    return aliases[token] ?? value.trim();
  }

  static String _displayColor(String value) {
    final token = _compact(value);
    if (token.contains('darkbrown') && token.contains('white')) return '深棕白';
    if (token.contains('brown') && token.contains('white')) return '棕白';
    if (token.contains('black') && token.contains('white')) return '黑白';
    if (token.contains('blue') && token.contains('white')) return '蓝白';
    if (token.contains('red') && token.contains('white')) return '红白';
    if (token.contains('green') && token.contains('white')) return '绿白';
    if (token.contains('grey') || token.contains('gray')) return '灰色';
    if (token.contains('black')) return '黑色';
    if (token.contains('white')) return '白色';
    if (token.contains('brown')) return '棕色';
    if (token.contains('blue')) return '蓝色';
    if (token.contains('red')) return '红色';
    if (token.contains('green')) return '绿色';
    if (token.contains('yellow')) return '黄色';
    if (token.contains('purple')) return '紫色';
    if (token.contains('pink')) return '粉色';
    return value.trim();
  }

  static String _displayShoeType(String value) {
    final token = _compact(value);
    const aliases = {
      'lifestyle': '休闲鞋',
      'lifestyleshoes': '休闲鞋',
      'casual': '休闲鞋',
      'casualshoes': '休闲鞋',
      'skate': '板鞋',
      'skateshoes': '板鞋',
      'running': '跑鞋',
      'runningshoes': '跑鞋',
      'basketball': '篮球鞋',
      'basketballshoes': '篮球鞋',
      'training': '训练鞋',
      'trainingshoes': '训练鞋',
      'boot': '靴子',
      'boots': '靴子',
      'sandal': '凉鞋',
      'sandals': '凉鞋',
    };
    return aliases[token] ?? value.trim();
  }

  static String _displayCategory(String value) {
    final token = _compact(value);
    const aliases = {
      'shoe': '鞋子',
      'camera': '相机',
      'headphones': '耳机',
      'smartwatch': '智能手表',
      'phone': '手机',
      'computer': '电脑',
      'tablet': '平板',
      'keyboard': '键盘',
      'mouse': '鼠标',
      'digitalother': '数码产品',
      'book': '图书',
      'books': '图书',
      'storybook': '绘本',
      'general': '',
    };
    return aliases[token] ?? value.trim();
  }

  static String _compact(String value) {
    return value.trim().toLowerCase().replaceAll(RegExp(r'[\s_-]+'), '');
  }
}

const Object _profileSentinel = Object();

class RefineCandidatesResponse {
  const RefineCandidatesResponse({
    required this.status,
    this.candidateSnapshotId,
    this.productProfile,
  });

  final String status;
  final String? candidateSnapshotId;
  final BackendProductProfile? productProfile;

  bool get isReady => status == 'ready' || status == 'degraded_ready';
  bool get isPending => status == 'tag_pending';
  bool get isFailed => status == 'tag_failed';

  factory RefineCandidatesResponse.fromJson(Map<String, dynamic> json) {
    final refine = _asMap(json['refine']);
    final profileJson = _asMap(json['productProfile']);
    return RefineCandidatesResponse(
      status: refine['status']?.toString() ?? '',
      candidateSnapshotId: refine['candidateSnapshotId']?.toString(),
      productProfile: profileJson.isEmpty
          ? null
          : BackendProductProfile.fromJson(profileJson),
    );
  }
}

class TurnSubmitResponse {
  const TurnSubmitResponse({
    required this.candidates,
    required this.assistantMessage,
    required this.intent,
    required this.stateChangingTurn,
  });

  final CandidateListResponse candidates;
  final String assistantMessage;
  final String intent;
  final bool stateChangingTurn;

  factory TurnSubmitResponse.fromJson(Map<String, dynamic> json) {
    final turn = _asMap(json['turn']);
    final parsedFilter = _asMap(turn['parsedFilter']);
    final conversationState = _asMap(json['conversationState']);
    final intent = parsedFilter['intent']?.toString() ?? '';
    final stateChangingTurn = conversationState['stateChangingTurn'];
    return TurnSubmitResponse(
      candidates: CandidateListResponse.fromJson(_asMap(json['candidates'])),
      assistantMessage: json['assistantMessage']?.toString() ?? '',
      intent: intent,
      stateChangingTurn: stateChangingTurn is bool
          ? stateChangingTurn
          : intent == 'refine_filter' || intent == 'reset_filter',
    );
  }
}

class SuggestionListResponse {
  const SuggestionListResponse({
    required this.recommendationConclusion,
    required this.cards,
    required this.nextRefineOptions,
    required this.raw,
  });

  final String recommendationConclusion;
  final List<SuggestionCard> cards;
  final List<SuggestionRefineOption> nextRefineOptions;
  final Map<String, dynamic> raw;

  factory SuggestionListResponse.fromJson(Map<String, dynamic> json) {
    return SuggestionListResponse(
      recommendationConclusion:
          json['recommendationConclusion']?.toString() ?? '',
      cards: [
        for (final item in _asList(json['cards']))
          SuggestionCard.fromJson(_asMap(item)),
      ],
      nextRefineOptions: [
        for (final item in _asList(json['nextRefineOptions']))
          SuggestionRefineOption.fromJson(_asMap(item)),
      ],
      raw: json,
    );
  }
}

class SuggestionRefineOption {
  const SuggestionRefineOption({
    required this.title,
    required this.message,
  });

  final String title;
  final String message;

  factory SuggestionRefineOption.fromJson(Map<String, dynamic> json) {
    return SuggestionRefineOption(
      title: json['title']?.toString() ?? '',
      message: json['message']?.toString() ?? '',
    );
  }
}

class SuggestionCard {
  const SuggestionCard({
    required this.cardId,
    required this.type,
    required this.title,
    required this.reason,
    required this.confidence,
    required this.priority,
    required this.action,
    required this.preview,
    this.subtitle,
  });

  final String cardId;
  final String type;
  final String title;
  final String? subtitle;
  final String reason;
  final double confidence;
  final int priority;
  final SuggestionCardAction action;
  final SuggestionCardPreview preview;

  factory SuggestionCard.fromJson(Map<String, dynamic> json) {
    return SuggestionCard(
      cardId: json['cardId']?.toString() ?? '',
      type: json['type']?.toString() ?? 'filter',
      title: json['title']?.toString() ?? '',
      subtitle: _nullableString(json['subtitle']),
      reason:
          json['reason']?.toString() ?? json['triggerReason']?.toString() ?? '',
      confidence: _toDouble(json['confidence']),
      priority: _toInt(json['priority']),
      action: SuggestionCardAction.fromJson(
        _asMap(json['action']),
        legacyPayload: _asMap(json['payload']),
        legacyActionType: json['actionType']?.toString(),
        fallbackMessage: json['title']?.toString(),
      ),
      preview: SuggestionCardPreview.fromJson(_asMap(json['preview'])),
    );
  }
}

class SuggestionCardAction {
  const SuggestionCardAction({
    required this.type,
    required this.filterPatch,
    this.message,
    this.candidateItemId,
    this.field,
  });

  final String type;
  final String? message;
  final String? candidateItemId;
  final String? field;
  final Map<String, dynamic> filterPatch;

  factory SuggestionCardAction.fromJson(
    Map<String, dynamic> json, {
    Map<String, dynamic> legacyPayload = const <String, dynamic>{},
    String? legacyActionType,
    String? fallbackMessage,
  }) {
    final hasAction = json.isNotEmpty;
    final type = json['type']?.toString() ??
        (legacyActionType == 'ask_user' ? 'open_filter_sheet' : 'submit_turn');
    final message = json['message']?.toString() ??
        _messageFromLegacyPayload(legacyPayload) ??
        (type == 'submit_turn' ? fallbackMessage : null);
    return SuggestionCardAction(
      type: hasAction ? type : type,
      message: message,
      candidateItemId: _nullableString(json['candidateItemId']),
      field: _nullableString(json['field']),
      filterPatch: _asMap(json['filterPatch']).isNotEmpty
          ? _asMap(json['filterPatch'])
          : legacyPayload,
    );
  }

  static String? _messageFromLegacyPayload(Map<String, dynamic> payload) {
    if (payload['stockOnly'] == true) return '只看有货';
    if (payload['shopType']?.toString() == 'flagship') return '只看旗舰店';
    final priceMax = payload['priceMax'] ?? payload['maxPrice'];
    if (priceMax != null) return '$priceMax以内';
    return null;
  }
}

class SuggestionCardPreview {
  const SuggestionCardPreview({
    required this.remainingCount,
    required this.affectedFields,
  });

  final int? remainingCount;
  final List<String> affectedFields;

  factory SuggestionCardPreview.fromJson(Map<String, dynamic> json) {
    return SuggestionCardPreview(
      remainingCount: json.containsKey('remainingCount')
          ? _toInt(json['remainingCount'])
          : null,
      affectedFields: [
        for (final item in _asList(json['affectedFields'])) item.toString(),
      ],
    );
  }
}

class UserProfileResponse {
  const UserProfileResponse({
    required this.userId,
    required this.blocks,
  });

  final String userId;
  final List<UserProfileBlock> blocks;

  factory UserProfileResponse.empty() {
    return const UserProfileResponse(userId: '', blocks: []);
  }

  factory UserProfileResponse.fromJson(Map<String, dynamic> json) {
    final blocks = _asList(json['blocks']);
    return UserProfileResponse(
      userId: json['userId']?.toString() ?? '',
      blocks: [
        for (var index = 0; index < blocks.length; index += 1)
          UserProfileBlock.fromJson(_asMap(blocks[index])),
      ],
    );
  }

  UserProfileBlock? findBlock(String blockType, String scope) {
    for (final block in blocks) {
      if (block.blockType == blockType &&
          block.scope == scope &&
          block.status == 'active') {
        return block;
      }
    }
    return null;
  }
}

class UserProfileBlock {
  const UserProfileBlock({
    required this.blockId,
    required this.blockType,
    required this.scope,
    required this.payload,
    required this.sensitivity,
    required this.status,
    this.updatedAt,
  });

  final String blockId;
  final String blockType;
  final String scope;
  final Map<String, dynamic> payload;
  final String sensitivity;
  final String status;
  final String? updatedAt;

  factory UserProfileBlock.fromJson(Map<String, dynamic> json) {
    return UserProfileBlock(
      blockId: json['blockId']?.toString() ?? '',
      blockType: json['blockType']?.toString() ?? '',
      scope: json['scope']?.toString() ?? 'global',
      payload: _asMap(json['payload']),
      sensitivity: json['sensitivity']?.toString() ?? 'low',
      status: json['status']?.toString() ?? 'active',
      updatedAt: json['updatedAt']?.toString(),
    );
  }
}

class CandidateListResponse {
  const CandidateListResponse({
    required this.candidateSnapshotId,
    required this.items,
    required this.nextCursor,
    required this.hasMore,
  });

  final String candidateSnapshotId;
  final List<BackendCandidateItem> items;
  final String? nextCursor;
  final bool hasMore;

  factory CandidateListResponse.fromJson(Map<String, dynamic> json) {
    final items = _asList(json['items']);
    final cursor = _asMap(json['cursor']);
    return CandidateListResponse(
      candidateSnapshotId: json['candidateSnapshotId']?.toString() ?? '',
      nextCursor: cursor['nextCursor']?.toString(),
      hasMore: cursor['hasMore'] is bool ? cursor['hasMore'] as bool : false,
      items: [
        for (var index = 0; index < items.length; index += 1)
          BackendCandidateItem.fromJson(_asMap(items[index]), index),
      ],
    );
  }
}

class BackendCandidateItem {
  const BackendCandidateItem({
    required this.candidateItemId,
    required this.title,
    required this.platformName,
    required this.amount,
    required this.currency,
    required this.shopName,
    required this.shopType,
    required this.stockStatus,
    required this.coverImageUrl,
    required this.productUrl,
    required this.platformProductId,
    required this.platformBrandId,
    required this.recommendationReason,
    required this.matchSummary,
    required this.normalizedAttributes,
    required this.commerceMeta,
    required this.sortSignals,
    required this.rawPayload,
    required this.decisionTags,
    required this.decisionSupport,
  });

  final String candidateItemId;
  final String title;
  final String platformName;
  final double amount;
  final String currency;
  final String shopName;
  final String shopType;
  final String stockStatus;
  final String coverImageUrl;
  final String productUrl;
  final String? platformProductId;
  final String? platformBrandId;
  final List<String> recommendationReason;
  final Map<String, dynamic> matchSummary;
  final Map<String, dynamic> normalizedAttributes;
  final Map<String, dynamic> commerceMeta;
  final Map<String, dynamic> sortSignals;
  final Map<String, dynamic> rawPayload;
  final List<String> decisionTags;
  final Map<String, dynamic> decisionSupport;

  factory BackendCandidateItem.fromJson(Map<String, dynamic> json, int index) {
    final price = _asMap(json['price']);
    final rawDecisionTags = _asList(json['decisionTags']);
    final normalizedAttributes = _asMap(json['normalizedAttributes']);
    return BackendCandidateItem(
      candidateItemId: json['candidateItemId']?.toString() ??
          json['id']?.toString() ??
          'remote-$index',
      title: json['title']?.toString() ?? '未命名商品',
      platformName: json['platformName']?.toString() ?? '平台',
      amount: _toDouble(price['amount'] ?? json['amount']),
      currency: price['currency']?.toString() ??
          json['currency']?.toString() ??
          'CNY',
      shopName: json['shopName']?.toString() ?? '',
      shopType: json['shopType']?.toString() ?? '',
      stockStatus: json['stockStatus']?.toString() ?? 'unknown',
      coverImageUrl: json['coverImageUrl']?.toString() ?? '',
      productUrl: json['productUrl']?.toString() ?? '',
      platformProductId: _nullableString(
        json['platformProductId'] ?? normalizedAttributes['platformProductId'],
      ),
      platformBrandId: _nullableString(
        json['platformBrandId'] ?? normalizedAttributes['platformBrandId'],
      ),
      recommendationReason: [
        for (final item in _asList(json['recommendationReason']))
          item.toString(),
      ],
      matchSummary: _asMap(json['matchSummary']),
      normalizedAttributes: normalizedAttributes,
      commerceMeta: _asMap(json['commerceMeta']),
      sortSignals: _asMap(json['sortSignals']),
      rawPayload: _asMap(json['rawPayload']),
      decisionTags: [
        for (final item in rawDecisionTags)
          if (item is Map && item['label'] != null)
            item['label'].toString()
          else
            item.toString(),
      ],
      decisionSupport: _asMap(json['decisionSupport']),
    );
  }
}

Map<String, dynamic> _asMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return <String, dynamic>{};
}

List<Object?> _asList(Object? value) {
  if (value is List) return value;
  return const [];
}

List<String> _stringList(Object? value) {
  return [
    for (final item in _asList(value))
      if (_nullableString(item) != null) _nullableString(item)!,
  ];
}

double _toDouble(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? 0;
  return 0;
}

int _toInt(Object? value) {
  if (value is num) return value.round();
  if (value is String) return int.tryParse(value) ?? 0;
  return 0;
}

String? _nullableString(Object? value) {
  final normalized = value?.toString().trim();
  return normalized == null || normalized.isEmpty ? null : normalized;
}

MediaType _imageContentType(String path) {
  final lower = path.toLowerCase();
  if (lower.endsWith('.png')) return MediaType('image', 'png');
  if (lower.endsWith('.webp')) return MediaType('image', 'webp');
  return MediaType('image', 'jpeg');
}
