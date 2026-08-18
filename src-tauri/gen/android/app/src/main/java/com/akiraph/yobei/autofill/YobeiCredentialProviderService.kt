package com.akiraph.yobei.autofill

import android.credentials.CreateCredentialException
import android.credentials.GetCredentialException
import android.os.Build
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import android.service.credentials.BeginCreateCredentialRequest
import android.service.credentials.BeginCreateCredentialResponse
import android.service.credentials.BeginGetCredentialRequest
import android.service.credentials.BeginGetCredentialResponse
import android.service.credentials.ClearCredentialStateRequest
import android.service.credentials.CredentialProviderService
import androidx.annotation.RequiresApi

/**
 * Discovery entry point for Android 14+ Credential Manager.
 *
 * Password filling currently uses AutofillService. Returning an empty response
 * here keeps Yobei discoverable as a provider without claiming passkey support
 * before the structured WebAuthn credential model is implemented.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class YobeiCredentialProviderService : CredentialProviderService() {
    override fun onBeginGetCredential(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        outcome: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
    ) {
        if (!cancellationSignal.isCanceled) outcome.onResult(BeginGetCredentialResponse())
    }

    override fun onBeginCreateCredential(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        outcome: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
    ) {
        if (!cancellationSignal.isCanceled) outcome.onResult(BeginCreateCredentialResponse())
    }

    override fun onClearCredentialState(
        request: ClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        outcome: OutcomeReceiver<Void, android.credentials.ClearCredentialStateException>,
    ) {
        if (!cancellationSignal.isCanceled) outcome.onResult(null)
    }
}
