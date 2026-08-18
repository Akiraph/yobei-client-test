package com.akiraph.yobei.autofill

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.autofill.AutofillId

internal data class AutofillForm(
    val usernameId: AutofillId?,
    val passwordId: AutofillId?,
    val origin: String,
)

internal object AutofillFormReader {
    fun read(structure: AssistStructure): AutofillForm? {
        var username: AutofillId? = null
        var password: AutofillId? = null
        var origin = ""

        fun visit(node: AssistStructure.ViewNode) {
            if (origin.isEmpty()) {
                origin = node.webDomain.orEmpty()
            }
            val hints = node.autofillHints?.map(String::lowercase).orEmpty()
            val hint = node.hint?.toString()?.lowercase().orEmpty()
            val idEntry = node.idEntry?.lowercase().orEmpty()
            val inputType = node.inputType
            val isPassword = hints.any { it.contains("password") } ||
                (inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0 ||
                (inputType and InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD) != 0 ||
                hint.contains("password") ||
                idEntry.contains("password")
            val isUsername = hints.any {
                it.contains("username") || it.contains("email") || it.contains("login")
            } || hint.contains("username") || hint.contains("email") ||
                idEntry.contains("username") || idEntry.contains("email") ||
                idEntry.contains("login")

            if (password == null && isPassword) password = node.autofillId
            if (username == null && isUsername && !isPassword) username = node.autofillId

            for (index in 0 until node.childCount) {
                visit(node.getChildAt(index))
            }
        }

        for (index in 0 until structure.windowNodeCount) {
            visit(structure.getWindowNodeAt(index).rootViewNode)
        }
        return if (username == null && password == null) null else AutofillForm(username, password, origin)
    }
}
