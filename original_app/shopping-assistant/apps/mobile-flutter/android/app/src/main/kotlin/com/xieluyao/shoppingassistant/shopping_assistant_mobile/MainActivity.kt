package com.xieluyao.shoppingassistant.shopping_assistant_mobile

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

class MainActivity : FlutterActivity() {
    private val voiceChannelName = "shopping_assistant/voice"
    private val locationChannelName = "shopping_assistant/location"
    private val latestScreenshotChannelName = "shopping_assistant/latest_screenshot"
    private val readMediaImagesPermission = "android.permission.READ_MEDIA_IMAGES"
    private val readMediaVisualUserSelectedPermission = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
    private val readExternalStoragePermission = "android.permission.READ_EXTERNAL_STORAGE"
    private val screenshotKeywords = listOf(
        "screenshot",
        "screenshots",
        "screen_shot",
        "screencap",
        "截图",
        "截屏",
        "屏幕截图"
    )
    private val recordAudioRequestCode = 7301
    private val speechActivityRequestCode = 7302
    private val locationRequestCode = 7303
    private var permissionResult: MethodChannel.Result? = null
    private var permissionMode: String? = null
    private var locationResult: MethodChannel.Result? = null
    private var activeResult: MethodChannel.Result? = null
    private var speechRecognizer: SpeechRecognizer? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, voiceChannelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "ensurePermission" -> ensureVoicePermission(result)
                    "listen" -> startVoiceInput(result)
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, locationChannelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "currentCity" -> resolveCurrentCity(result)
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, latestScreenshotChannelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "findLatestScreenshot" -> findLatestScreenshot(call.arguments, result)
                    else -> result.notImplemented()
                }
            }
    }

    private fun ensureVoicePermission(result: MethodChannel.Result) {
        if (hasRecordAudioPermission()) {
            result.success(true)
            return
        }
        if (permissionResult != null || activeResult != null) {
            result.error("busy", "正在处理语音权限，请稍等。", null)
            return
        }
        permissionResult = result
        permissionMode = "permission"
        requestRecordAudioPermission()
    }

    private fun startVoiceInput(result: MethodChannel.Result) {
        if (activeResult != null || permissionResult != null) {
            result.error("busy", "正在听写中，请稍等。", null)
            return
        }

        if (!hasRecordAudioPermission()) {
            permissionResult = result
            permissionMode = "listen"
            requestRecordAudioPermission()
            return
        }

        if (SpeechRecognizer.isRecognitionAvailable(this)) {
            launchRecognizer(result)
        } else {
            launchSpeechActivity(result)
        }
    }

    private fun hasRecordAudioPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestRecordAudioPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), recordAudioRequestCode)
        }
    }

    private fun findLatestScreenshot(arguments: Any?, result: MethodChannel.Result) {
        if (!hasImageReadPermission()) {
            result.success(null)
            return
        }

        val args = arguments as? Map<*, *>
        val maxAgeMs = (args?.get("maxAgeMs") as? Number)?.toLong() ?: 180_000L
        val limit = ((args?.get("limit") as? Number)?.toInt() ?: 20).coerceIn(1, 50)
        val minSizeBytes = (args?.get("minSizeBytes") as? Number)?.toLong() ?: 20_480L

        val screenshot = try {
            queryLatestScreenshot(maxAgeMs, limit, minSizeBytes)
        } catch (_: SecurityException) {
            null
        } catch (_: Exception) {
            null
        }
        result.success(screenshot)
    }

    private fun hasImageReadPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val hasFullAccess =
                checkSelfPermission(readMediaImagesPermission) == PackageManager.PERMISSION_GRANTED
            val hasSelectedAccess =
                Build.VERSION.SDK_INT >= 34 &&
                    checkSelfPermission(readMediaVisualUserSelectedPermission) ==
                    PackageManager.PERMISSION_GRANTED
            return hasFullAccess || hasSelectedAccess
        }
        return checkSelfPermission(readExternalStoragePermission) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun queryLatestScreenshot(
        maxAgeMs: Long,
        limit: Int,
        minSizeBytes: Long
    ): Map<String, Any>? {
        val projection = recentImageProjection()
        val cursor = queryRecentImages(projection, limit) ?: return null
        val nowMs = System.currentTimeMillis()
        cursor.use {
            var checked = 0
            while (it.moveToNext() && checked < limit) {
                checked += 1
                val id = it.getLongOrZero(MediaStore.Images.Media._ID)
                if (id <= 0L) continue

                val displayName = it.getStringOrEmpty(MediaStore.Images.Media.DISPLAY_NAME)
                val mimeType = it.getStringOrEmpty(MediaStore.Images.Media.MIME_TYPE)
                val sizeBytes = it.getLongOrZero(MediaStore.Images.Media.SIZE)
                val dateAddedMs = normalizeDateAddedMs(
                    it.getLongOrZero(MediaStore.Images.Media.DATE_ADDED)
                )
                val dateTakenMs = it.getLongOrZero(MediaStore.Images.Media.DATE_TAKEN)
                val relativePath = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    it.getStringOrEmpty(MediaStore.Images.Media.RELATIVE_PATH)
                } else {
                    ""
                }
                val legacyPath = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    @Suppress("DEPRECATION")
                    it.getStringOrEmpty(MediaStore.Images.Media.DATA)
                } else {
                    ""
                }

                if (!mimeType.startsWith("image/")) continue
                if (sizeBytes < minSizeBytes) continue
                if (!isRecentMedia(nowMs, maxAgeMs, dateAddedMs, dateTakenMs)) continue
                if (!looksLikeScreenshot(displayName, relativePath, legacyPath)) continue

                val uri = ContentUris.withAppendedId(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id
                )
                val cacheFile = copyScreenshotToCache(uri, displayName, mimeType, id)
                    ?: continue
                cleanLatestScreenshotCache()
                return mapOf(
                    "uri" to uri.toString(),
                    "cachePath" to cacheFile.absolutePath,
                    "displayName" to displayName,
                    "relativePath" to relativePath.ifBlank { legacyPath },
                    "dateAddedMs" to dateAddedMs,
                    "dateTakenMs" to dateTakenMs,
                    "sizeBytes" to sizeBytes
                )
            }
        }
        return null
    }

    private fun recentImageProjection(): Array<String> {
        val columns = mutableListOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.SIZE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            columns.add(MediaStore.Images.Media.RELATIVE_PATH)
        } else {
            @Suppress("DEPRECATION")
            columns.add(MediaStore.Images.Media.DATA)
        }
        return columns.toTypedArray()
    }

    private fun queryRecentImages(projection: Array<String>, limit: Int): Cursor? {
        val uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val args = Bundle().apply {
                putStringArray(
                    ContentResolver.QUERY_ARG_SORT_COLUMNS,
                    arrayOf(MediaStore.Images.Media.DATE_ADDED)
                )
                putInt(
                    ContentResolver.QUERY_ARG_SORT_DIRECTION,
                    ContentResolver.QUERY_SORT_DIRECTION_DESCENDING
                )
                putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
            }
            contentResolver.query(uri, projection, args, null)
        } else {
            contentResolver.query(
                uri,
                projection,
                null,
                null,
                "${MediaStore.Images.Media.DATE_ADDED} DESC LIMIT $limit"
            )
        }
    }

    private fun normalizeDateAddedMs(value: Long): Long {
        if (value <= 0L) return 0L
        return if (value > 10_000_000_000L) value else value * 1000L
    }

    private fun isRecentMedia(
        nowMs: Long,
        maxAgeMs: Long,
        dateAddedMs: Long,
        dateTakenMs: Long
    ): Boolean {
        val mediaTimeMs = listOf(dateAddedMs, dateTakenMs)
            .filter { it > 0L }
            .maxOrNull()
            ?: return false
        if (mediaTimeMs - nowMs > 60_000L) return false
        return nowMs - mediaTimeMs <= maxAgeMs
    }

    private fun looksLikeScreenshot(
        displayName: String,
        relativePath: String,
        legacyPath: String
    ): Boolean {
        val source = "$displayName $relativePath $legacyPath".lowercase(Locale.ROOT)
        return screenshotKeywords.any { keyword -> source.contains(keyword) }
    }

    private fun copyScreenshotToCache(
        uri: Uri,
        displayName: String,
        mimeType: String,
        id: Long
    ): File? {
        val extension = imageExtension(displayName, mimeType)
        val target = File(
            cacheDir,
            "latest_screenshot_${System.currentTimeMillis()}_$id.$extension"
        )
        return try {
            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(target).use { output ->
                    input.copyTo(output)
                }
            } ?: return null
            if (!target.exists() || target.length() <= 0L) {
                target.delete()
                null
            } else {
                target
            }
        } catch (_: Exception) {
            target.delete()
            null
        }
    }

    private fun imageExtension(displayName: String, mimeType: String): String {
        val nameExtension = displayName.substringAfterLast('.', "")
            .lowercase(Locale.ROOT)
        val allowed = setOf("jpg", "jpeg", "png", "webp", "heic", "heif")
        if (nameExtension in allowed) return nameExtension
        return when (mimeType.lowercase(Locale.ROOT)) {
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/heic" -> "heic"
            "image/heif" -> "heif"
            else -> "jpg"
        }
    }

    private fun cleanLatestScreenshotCache() {
        val files = cacheDir.listFiles { file ->
            file.isFile && file.name.startsWith("latest_screenshot_")
        } ?: return
        files
            .sortedByDescending { it.lastModified() }
            .drop(6)
            .forEach { file -> runCatching { file.delete() } }
    }

    private fun Cursor.getStringOrEmpty(column: String): String {
        val index = getColumnIndex(column)
        if (index < 0 || isNull(index)) return ""
        return getString(index).orEmpty()
    }

    private fun Cursor.getLongOrZero(column: String): Long {
        val index = getColumnIndex(column)
        if (index < 0 || isNull(index)) return 0L
        return getLong(index)
    }

    private fun resolveCurrentCity(result: MethodChannel.Result) {
        if (!hasLocationPermission()) {
            if (locationResult != null) {
                result.error("busy", "正在处理定位权限，请稍等。", null)
                return
            }
            locationResult = result
            requestLocationPermission()
            return
        }
        finishWithCurrentCity(result)
    }

    private fun hasLocationPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestLocationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                ),
                locationRequestCode
            )
        }
    }

    private fun finishWithCurrentCity(result: MethodChannel.Result) {
        val location = lastKnownLocation()
        if (location == null) {
            result.error("location_unavailable", "暂时没有可用定位，请确认已打开手机定位。", null)
            return
        }

        val city = cityFromLocation(location)
        result.success(city.ifBlank { "当前位置" })
    }

    private fun lastKnownLocation(): Location? {
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(
            LocationManager.NETWORK_PROVIDER,
            LocationManager.GPS_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        )
        return providers
            .filter { provider -> manager.isProviderEnabled(provider) }
            .mapNotNull { provider ->
                try {
                    manager.getLastKnownLocation(provider)
                } catch (_: SecurityException) {
                    null
                } catch (_: IllegalArgumentException) {
                    null
                }
            }
            .maxByOrNull { it.time }
    }

    @Suppress("DEPRECATION")
    private fun cityFromLocation(location: Location): String {
        return try {
            val geocoder = Geocoder(this, Locale.getDefault())
            val address = geocoder.getFromLocation(location.latitude, location.longitude, 1)
                ?.firstOrNull()
            address?.locality
                ?: address?.subAdminArea
                ?: address?.adminArea
                ?: "当前位置"
        } catch (_: Exception) {
            "当前位置"
        }
    }

    private fun launchRecognizer(result: MethodChannel.Result) {
        activeResult = result
        speechRecognizer?.destroy()
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).also { recognizer ->
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit

                override fun onError(error: Int) {
                    if (error == SpeechRecognizer.ERROR_CLIENT ||
                        error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                    ) {
                        fallbackToSpeechActivity()
                    } else {
                        finishWithError("recognition_error", readableSpeechError(error))
                    }
                }

                override fun onResults(results: Bundle?) {
                    val matches = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        .orEmpty()
                    finishWithText(matches.firstOrNull().orEmpty())
                }
            })

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, Locale.SIMPLIFIED_CHINESE.toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "说出你的鞋款要求")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            }
            recognizer.startListening(intent)
        }
    }

    private fun fallbackToSpeechActivity() {
        val result = activeResult ?: return
        activeResult = null
        speechRecognizer?.destroy()
        speechRecognizer = null
        launchSpeechActivity(result)
    }

    private fun launchSpeechActivity(result: MethodChannel.Result) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, Locale.SIMPLIFIED_CHINESE.toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PROMPT, "说出你的鞋款要求")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

        val canHandle = intent.resolveActivity(packageManager) != null
        if (!canHandle) {
            result.error("unavailable", "这台手机没有可用的系统语音识别入口。", null)
            return
        }

        activeResult = result
        try {
            startActivityForResult(intent, speechActivityRequestCode)
        } catch (error: ActivityNotFoundException) {
            activeResult = null
            result.error("unavailable", "这台手机没有可用的系统语音识别入口。", null)
        }
    }

    private fun finishWithText(text: String) {
        activeResult?.success(text)
        activeResult = null
        speechRecognizer?.destroy()
        speechRecognizer = null
    }

    private fun finishWithError(code: String, message: String) {
        activeResult?.error(code, message, null)
        activeResult = null
        speechRecognizer?.destroy()
        speechRecognizer = null
    }

    private fun readableSpeechError(error: Int): String {
        return when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "录音暂时不可用，请稍后再试。"
            SpeechRecognizer.ERROR_CLIENT -> "语音服务暂时不可用，可以先手动输入。"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "需要麦克风权限才能语音输入。"
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "语音识别需要网络，请检查连接。"
            SpeechRecognizer.ERROR_NO_MATCH -> "没有听清楚，可以再说一次。"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "语音识别正在忙，请稍后再试。"
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "没有听到声音，可以再试一次。"
            else -> "暂时无法使用语音输入。"
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == locationRequestCode) {
            val result = locationResult ?: return
            locationResult = null
            if (grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
                finishWithCurrentCity(result)
            } else {
                result.error("permission_denied", "需要定位权限才能显示当前城市。", null)
            }
            return
        }

        if (requestCode != recordAudioRequestCode) return

        val result = permissionResult ?: return
        val mode = permissionMode
        permissionResult = null
        permissionMode = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            if (mode == "listen") {
                if (SpeechRecognizer.isRecognitionAvailable(this)) {
                    launchRecognizer(result)
                } else {
                    launchSpeechActivity(result)
                }
            } else {
                result.success(true)
            }
        } else {
            result.error("permission_denied", "需要麦克风权限才能语音输入。", null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != speechActivityRequestCode) return

        val result = activeResult ?: return
        activeResult = null
        if (resultCode == Activity.RESULT_OK) {
            val matches = data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                .orEmpty()
            result.success(matches.firstOrNull().orEmpty())
        } else {
            result.error("cancelled", "已取消语音输入。", null)
        }
    }

    override fun onDestroy() {
        speechRecognizer?.destroy()
        speechRecognizer = null
        super.onDestroy()
    }
}
