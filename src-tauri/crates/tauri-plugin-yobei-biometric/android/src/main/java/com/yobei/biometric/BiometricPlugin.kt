package com.yobei.biometric

import android.app.Activity
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val BIOMETRIC_KEY_ALIAS = "yobei_biometric_key"
private const val BIOMETRIC_DATA_KEY_ALIAS = "yobei_biometric_data_key"
private const val DEVICE_KEY_ALIAS = "yobei_device_key"
private const val KEY_TIMEOUT_SECONDS = 30
private const val GCM_IV_LENGTH = 12
private const val GCM_TAG_LENGTH_BYTES = 16
private const val GCM_TAG_LENGTH_BITS = GCM_TAG_LENGTH_BYTES * 8

private object ErrorCode {
    const val UNAVAILABLE = "biometric_unavailable"
    const val INVALID_INPUT = "invalid_input"
    const val DATA_CORRUPT = "data_corrupt"
    const val CRYPTO_FAILED = "crypto_failed"
    const val OPERATION_FAILED = "operation_failed"
}

private fun encodeBase64(bytes: ByteArray): String =
    Base64.encodeToString(bytes, Base64.NO_WRAP)

private fun decodeBase64(value: String): ByteArray =
    Base64.decode(value, Base64.DEFAULT)

@InvokeArg
class RequestArgs {
    var message: String = ""
}

@InvokeArg
class ProtectArgs {
    var plaintext: String = ""
}

@InvokeArg
class UnprotectArgs {
    var blob: String = ""
}

@InvokeArg
class DeleteArgs {
    var blob: String = ""
}

@TauriPlugin
class BiometricPlugin(private val activity: Activity) : Plugin(activity) {
    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    }

    @Command
    fun isAvailable(invoke: Invoke) {
        invoke.resolve(JSObject().put("available", canAuthenticate()))
    }

    @Command
    fun request(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(RequestArgs::class.java)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.INVALID_INPUT, R.string.biometric_invalid_input)
            return
        }
        if (!canAuthenticate()) {
            reject(invoke, ErrorCode.UNAVAILABLE, R.string.biometric_unavailable)
            return
        }
        authenticate(
            subtitle = args.message.ifBlank { getString(R.string.biometric_subtitle) },
            onSuccess = { invoke.resolve(JSObject().put("ok", true)) },
            onError = { code, message -> reject(invoke, code, message) },
        )
    }

    @Command
    fun protectSecret(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(ProtectArgs::class.java)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.INVALID_INPUT, R.string.biometric_invalid_input)
            return
        }
        val plaintext = try {
            decodeBase64(args.plaintext)
        } catch (_: IllegalArgumentException) {
            reject(invoke, ErrorCode.INVALID_INPUT, R.string.biometric_invalid_input)
            return
        }
        val key = try {
            getOrCreateKey(BIOMETRIC_DATA_KEY_ALIAS, userAuthentication = false)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.OPERATION_FAILED, R.string.biometric_key_unavailable)
            return
        }
        try {
            invoke.resolve(JSObject().put("blob", encrypt(key, plaintext)))
        } catch (_: UserNotAuthenticatedException) {
            authenticate(
                subtitle = getString(R.string.biometric_protect_subtitle),
                onSuccess = { resolveProtected(invoke, key, plaintext) },
                onError = { code, message -> reject(invoke, code, message) },
            )
        } catch (_: KeyPermanentlyInvalidatedException) {
            invalidateKey(invoke)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.CRYPTO_FAILED, R.string.biometric_crypto_failed)
        }
    }

    @Command
    fun unprotectSecret(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(UnprotectArgs::class.java)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.INVALID_INPUT, R.string.biometric_invalid_input)
            return
        }
        val raw = try {
            decodeBase64(args.blob)
        } catch (_: IllegalArgumentException) {
            reject(invoke, ErrorCode.DATA_CORRUPT, R.string.biometric_invalid_blob)
            return
        }
        if (raw.size < GCM_IV_LENGTH + GCM_TAG_LENGTH_BYTES) {
            reject(invoke, ErrorCode.DATA_CORRUPT, R.string.biometric_invalid_blob)
            return
        }
        val key = try {
            getBiometricDataKey()
        } catch (_: Exception) {
            reject(invoke, ErrorCode.OPERATION_FAILED, R.string.biometric_key_unavailable)
            return
        }
        try {
            invoke.resolve(JSObject().put("plaintext", decrypt(key, raw)))
        } catch (_: UserNotAuthenticatedException) {
            authenticate(
                subtitle = getString(R.string.biometric_unprotect_subtitle),
                onSuccess = { resolveUnprotected(invoke, key, raw) },
                onError = { code, message -> reject(invoke, code, message) },
            )
        } catch (_: KeyPermanentlyInvalidatedException) {
            invalidateKey(invoke)
        } catch (_: AEADBadTagException) {
            reject(invoke, ErrorCode.DATA_CORRUPT, R.string.biometric_invalid_blob)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.CRYPTO_FAILED, R.string.biometric_crypto_failed)
        }
    }

    @Command
    fun deleteSecret(invoke: Invoke) {
        try {
            invoke.parseArgs(DeleteArgs::class.java)
            if (keyStore.containsAlias(BIOMETRIC_KEY_ALIAS)) {
                keyStore.deleteEntry(BIOMETRIC_KEY_ALIAS)
            }
            if (keyStore.containsAlias(BIOMETRIC_DATA_KEY_ALIAS)) {
                keyStore.deleteEntry(BIOMETRIC_DATA_KEY_ALIAS)
            }
            invoke.resolve(JSObject())
        } catch (_: Exception) {
            reject(invoke, ErrorCode.OPERATION_FAILED, R.string.biometric_key_unavailable)
        }
    }

    private fun canAuthenticate(): Boolean = try {
        BiometricManager.from(activity).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG,
        ) == BiometricManager.BIOMETRIC_SUCCESS
    } catch (_: Exception) {
        false
    }

    @Command
    fun protectDeviceSecret(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(ProtectArgs::class.java)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.INVALID_INPUT, R.string.biometric_invalid_input)
            return
        }
        val plaintext = try {
            decodeBase64(args.plaintext)
        } catch (_: IllegalArgumentException) {
            reject(invoke, ErrorCode.INVALID_INPUT, R.string.biometric_invalid_input)
            return
        }
        try {
            val key = getOrCreateKey(DEVICE_KEY_ALIAS, userAuthentication = false)
            invoke.resolve(JSObject().put("blob", encrypt(key, plaintext)))
        } catch (_: Exception) {
            reject(invoke, ErrorCode.CRYPTO_FAILED, R.string.biometric_crypto_failed)
        }
    }

    @Command
    fun unprotectDeviceSecret(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(UnprotectArgs::class.java)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.INVALID_INPUT, R.string.biometric_invalid_input)
            return
        }
        val raw = try {
            decodeBase64(args.blob)
        } catch (_: IllegalArgumentException) {
            reject(invoke, ErrorCode.DATA_CORRUPT, R.string.biometric_invalid_blob)
            return
        }
        if (raw.size < GCM_IV_LENGTH + GCM_TAG_LENGTH_BYTES) {
            reject(invoke, ErrorCode.DATA_CORRUPT, R.string.biometric_invalid_blob)
            return
        }
        try {
            val key = getOrCreateKey(DEVICE_KEY_ALIAS, userAuthentication = false)
            invoke.resolve(JSObject().put("plaintext", decrypt(key, raw)))
        } catch (_: AEADBadTagException) {
            reject(invoke, ErrorCode.DATA_CORRUPT, R.string.biometric_invalid_blob)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.CRYPTO_FAILED, R.string.biometric_crypto_failed)
        }
    }

    private fun getOrCreateKey(alias: String, userAuthentication: Boolean): SecretKey {
        keyStore.getKey(alias, null)?.let { return it as SecretKey }
        return try {
            generateKey(alias, userAuthentication, strongBox = true)
        } catch (_: Exception) {
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
            }
            generateKey(alias, userAuthentication, strongBox = false)
        }
    }

    private fun getBiometricDataKey(): SecretKey {
        if (keyStore.containsAlias(BIOMETRIC_DATA_KEY_ALIAS)) {
            return getOrCreateKey(BIOMETRIC_DATA_KEY_ALIAS, userAuthentication = false)
        }
        // Keep existing installations usable. Older releases encrypted the
        // blob with an authentication-bound key; new installations use the
        // prompt result as the native biometric gate so weak face unlocks work.
        if (keyStore.containsAlias(BIOMETRIC_KEY_ALIAS)) {
            return keyStore.getKey(BIOMETRIC_KEY_ALIAS, null) as SecretKey
        }
        return getOrCreateKey(BIOMETRIC_DATA_KEY_ALIAS, userAuthentication = false)
    }

    private fun generateKey(alias: String, userAuthentication: Boolean, strongBox: Boolean): SecretKey {
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(userAuthentication)
        if (userAuthentication) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setUserAuthenticationParameters(
                    KEY_TIMEOUT_SECONDS,
                    KeyProperties.AUTH_BIOMETRIC_STRONG,
                )
            } else {
                builder.setUserAuthenticationValidityDurationSeconds(KEY_TIMEOUT_SECONDS)
            }
        }
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(true)
        }
        generator.init(builder.build())
        return generator.generateKey()
    }

    private fun encrypt(key: SecretKey, plaintext: ByteArray): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        return encodeBase64(cipher.iv + cipher.doFinal(plaintext))
    }

    private fun decrypt(key: SecretKey, raw: ByteArray): String {
        val iv = raw.copyOfRange(0, GCM_IV_LENGTH)
        val ciphertext = raw.copyOfRange(GCM_IV_LENGTH, raw.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv),
        )
        return encodeBase64(cipher.doFinal(ciphertext))
    }

    private fun resolveProtected(invoke: Invoke, key: SecretKey, plaintext: ByteArray) {
        try {
            invoke.resolve(JSObject().put("blob", encrypt(key, plaintext)))
        } catch (_: KeyPermanentlyInvalidatedException) {
            invalidateKey(invoke)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.CRYPTO_FAILED, R.string.biometric_crypto_failed)
        }
    }

    private fun resolveUnprotected(invoke: Invoke, key: SecretKey, raw: ByteArray) {
        try {
            invoke.resolve(JSObject().put("plaintext", decrypt(key, raw)))
        } catch (_: KeyPermanentlyInvalidatedException) {
            invalidateKey(invoke)
        } catch (_: AEADBadTagException) {
            reject(invoke, ErrorCode.DATA_CORRUPT, R.string.biometric_invalid_blob)
        } catch (_: Exception) {
            reject(invoke, ErrorCode.CRYPTO_FAILED, R.string.biometric_crypto_failed)
        }
    }

    private fun invalidateKey(invoke: Invoke) {
        try {
            if (keyStore.containsAlias(BIOMETRIC_KEY_ALIAS)) {
                keyStore.deleteEntry(BIOMETRIC_KEY_ALIAS)
            }
            if (keyStore.containsAlias(BIOMETRIC_DATA_KEY_ALIAS)) {
                keyStore.deleteEntry(BIOMETRIC_DATA_KEY_ALIAS)
            }
        } catch (_: Exception) {
            reject(invoke, ErrorCode.OPERATION_FAILED, R.string.biometric_key_unavailable)
            return
        }
        reject(invoke, ErrorCode.OPERATION_FAILED, R.string.biometric_key_invalidated)
    }

    private fun authenticate(
        subtitle: String,
        onSuccess: () -> Unit,
        onError: (String, Int) -> Unit,
    ) {
        val fragmentActivity = activity as? FragmentActivity
        if (fragmentActivity == null) {
            onError(ErrorCode.OPERATION_FAILED, R.string.biometric_prompt_failed)
            return
        }
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            fragmentActivity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    _result: BiometricPrompt.AuthenticationResult,
                ) {
                    onSuccess()
                }

                override fun onAuthenticationFailed() {
                    // Keep the prompt open so the user can retry.
                }

                override fun onAuthenticationError(
                    errorCode: Int,
                    _errorMessage: CharSequence,
                ) {
                    val result = promptError(errorCode)
                    onError(result.first, result.second)
                }
            },
        )
        try {
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(getString(R.string.biometric_title))
                .setSubtitle(subtitle.ifBlank { getString(R.string.biometric_subtitle) })
                .setNegativeButtonText(getString(R.string.biometric_cancel))
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build()
            prompt.authenticate(info)
        } catch (_: Exception) {
            onError(ErrorCode.OPERATION_FAILED, R.string.biometric_prompt_failed)
        }
    }

    private fun promptError(errorCode: Int): Pair<String, Int> = when (errorCode) {
        BiometricPrompt.ERROR_USER_CANCELED,
        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
        BiometricPrompt.ERROR_CANCELED,
        -> ErrorCode.OPERATION_FAILED to R.string.biometric_cancelled

        BiometricPrompt.ERROR_LOCKOUT,
        BiometricPrompt.ERROR_LOCKOUT_PERMANENT,
        -> ErrorCode.OPERATION_FAILED to R.string.biometric_locked_out

        BiometricPrompt.ERROR_TIMEOUT -> ErrorCode.OPERATION_FAILED to R.string.biometric_timeout
        BiometricPrompt.ERROR_NO_BIOMETRICS,
        BiometricPrompt.ERROR_HW_UNAVAILABLE,
        BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL,
        -> ErrorCode.UNAVAILABLE to R.string.biometric_unavailable

        else -> ErrorCode.OPERATION_FAILED to R.string.biometric_failed
    }

    private fun getString(resourceId: Int): String = activity.getString(resourceId)

    private fun reject(invoke: Invoke, code: String, messageResource: Int) {
        invoke.reject(getString(messageResource), code)
    }
}
