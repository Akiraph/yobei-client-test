package com.akiraph.yobei.autofill

import org.json.JSONObject

/**
 * Thin JNI surface for the Android system adapters. The Rust Vault remains the
 * only credential owner; this class only carries short-lived JSON responses.
 */
internal object NativeBindings {
    private var loadError: Throwable? = null

    init {
        try {
            System.loadLibrary("yobei_client_lib")
        } catch (error: Throwable) {
            loadError = error
        }
    }

    fun available(): Boolean = loadError == null

    fun state(): JSONObject? = read(nativeState())

    fun listLogins(origin: String): List<JSONObject> {
        val array = readArray(nativeListLogins(origin)) ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                array.optJSONObject(index)?.let(::add)
            }
        }
    }

    fun getLogin(itemId: String): JSONObject? = read(nativeGetLogin(itemId))

    fun unlock(pin: String): JSONObject? = read(nativeUnlock(pin))

    private fun read(payload: ByteArray): JSONObject? = runCatching {
        JSONObject(payload.toString(Charsets.UTF_8))
    }.getOrNull()

    private fun readArray(payload: ByteArray): org.json.JSONArray? = runCatching {
        org.json.JSONArray(payload.toString(Charsets.UTF_8))
    }.getOrNull()

    @JvmStatic
    private external fun nativeState(): ByteArray

    @JvmStatic
    private external fun nativeListLogins(origin: String): ByteArray

    @JvmStatic
    private external fun nativeGetLogin(itemId: String): ByteArray

    @JvmStatic
    private external fun nativeUnlock(pin: String): ByteArray

    @JvmStatic
    private external fun nativeLock(): ByteArray
}
