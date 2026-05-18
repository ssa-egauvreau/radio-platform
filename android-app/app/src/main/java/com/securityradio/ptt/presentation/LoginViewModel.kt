package com.securityradio.ptt.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.securityradio.ptt.data.remote.LoginRequestDto
import com.securityradio.ptt.di.RadioAppGraph
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException

data class LoginUiState(
    val agencySlug: String = "",
    val username: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val errorMessage: String? = null,
)

class LoginViewModel(
    private val graph: RadioAppGraph,
) : ViewModel() {

    private val prefs = graph.radioPreferences

    private val _uiState = MutableStateFlow(
        LoginUiState(
            agencySlug = prefs.getSessionAgencySlug().ifBlank { "default" },
            username = prefs.getSessionUsername(),
        ),
    )
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun setAgencySlug(value: String) {
        _uiState.update { it.copy(agencySlug = value, errorMessage = null) }
    }

    fun setUsername(value: String) {
        _uiState.update { it.copy(username = value, errorMessage = null) }
    }

    fun setPassword(value: String) {
        _uiState.update { it.copy(password = value, errorMessage = null) }
    }

    fun signIn(onSuccess: () -> Unit) {
        val snapshot = _uiState.value
        val slug = snapshot.agencySlug.trim().lowercase()
        val username = snapshot.username.trim()
        val password = snapshot.password
        if (slug.isBlank() || username.isBlank() || password.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Enter agency, username, and password.") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, errorMessage = null) }
            try {
                val res = graph.authApi.login(
                    LoginRequestDto(
                        username = username,
                        password = password,
                        agency_slug = slug,
                    ),
                )
                if (res.user.role == "owner") {
                    _uiState.update {
                        it.copy(
                            busy = false,
                            errorMessage = "Platform owner accounts use the web console, not the radio app.",
                        )
                    }
                    return@launch
                }
                prefs.setAuthToken(res.token)
                prefs.setSessionAgencySlug(slug)
                prefs.setSessionUsername(username)
                graph.onAuthSessionChanged()
                _uiState.update { it.copy(busy = false, password = "") }
                onSuccess()
            } catch (http: HttpException) {
                val msg = when (http.code()) {
                    401 -> "Sign-in failed. Check agency code, username, and password."
                    403 -> "This account cannot use the radio app."
                    else -> "Sign-in failed (${http.code()})."
                }
                _uiState.update { it.copy(busy = false, errorMessage = msg) }
            } catch (_: Exception) {
                _uiState.update {
                    it.copy(busy = false, errorMessage = "Cannot reach the server. Check network and API URL.")
                }
            }
        }
    }
}
