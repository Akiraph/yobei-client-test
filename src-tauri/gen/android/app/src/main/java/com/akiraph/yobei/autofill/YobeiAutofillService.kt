package com.akiraph.yobei.autofill

import android.app.assist.AssistStructure
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillContext
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import com.akiraph.yobei.MainActivity
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@RequiresApi(Build.VERSION_CODES.O)
class YobeiAutofillService : AutofillService() {
    private val worker: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "yobei-autofill").apply { isDaemon = true }
    }

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback,
    ) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onSuccess(null)
            return
        }
        worker.execute {
            if (cancellationSignal.isCanceled) return@execute
            val form = AutofillFormReader.read(structure)
            if (form == null || form.passwordId == null) {
                callback.onSuccess(null)
                return@execute
            }
            if (!NativeBindings.available()) {
                openYobei()
                callback.onFailure("Yobei native Vault is unavailable")
                return@execute
            }
            val state = NativeBindings.state()
            if (state?.optString("phase") != "unlocked") {
                openYobei()
                callback.onFailure("Unlock Yobei before using Autofill")
                return@execute
            }
            val candidates = NativeBindings.listLogins(form.origin)
                .filter { matchesOrigin(it.optString("url"), form.origin) }
            if (candidates.isEmpty()) {
                callback.onSuccess(null)
                return@execute
            }

            val response = FillResponse.Builder()
            for (summary in candidates) {
                if (cancellationSignal.isCanceled) return@execute
                val item = NativeBindings.getLogin(summary.optString("id")) ?: continue
                val password = item.optString("password")
                if (password.isEmpty()) continue
                val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_2).apply {
                    setTextViewText(android.R.id.text1, summary.optString("title", "Yobei"))
                    setTextViewText(
                        android.R.id.text2,
                        summary.optString("username").ifBlank { summary.optString("url") },
                    )
                }
                val dataset = Dataset.Builder(presentation)
                form.usernameId?.let { id ->
                    val username = item.optString("username")
                    if (username.isNotEmpty()) dataset.setValue(id, AutofillValue.forText(username))
                }
                dataset.setValue(form.passwordId, AutofillValue.forText(password))
                response.addDataset(dataset.build())
            }
            callback.onSuccess(response.build())
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // The Android save callback is not a trusted confirmation surface. Do
        // not persist captured secrets silently; let the first-party Yobei UI
        // perform the explicit save confirmation instead.
        openYobei()
        callback.onFailure("Open Yobei to review and save this credential")
    }

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun matchesOrigin(itemUrl: String, requestedOrigin: String): Boolean {
        val requested = requestedOrigin.trim().lowercase().removePrefix("www.")
        if (requested.isEmpty()) return false
        val host = runCatching { Uri.parse(itemUrl).host?.lowercase() }.getOrNull()
            ?.removePrefix("www.") ?: return false
        return host == requested
    }

    private fun openYobei() {
        runCatching {
            startActivity(
                Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                },
            )
        }
    }
}
