package com.securityradio.ptt.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.securityradio.ptt.di.RadioAppGraph

class LoginViewModelFactory(
    private val graph: RadioAppGraph,
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(LoginViewModel::class.java)) {
            return LoginViewModel(graph) as T
        }
        throw IllegalArgumentException("Unknown ViewModel type ${modelClass.name}")
    }
}
