package com.securityradio.ptt.data.remote

import com.securityradio.ptt.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object NetworkModule {

    private fun buildRetrofit(
        baseUrl: String,
        authTokenProvider: () -> String,
        apiKeyProvider: () -> String,
    ): Retrofit {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }

        val authInterceptor = Interceptor { chain ->
            val token = authTokenProvider().trim()
            val apiKey = apiKeyProvider().trim()
            val builder = chain.request().newBuilder()
            if (token.isNotBlank()) {
                builder.header("Authorization", "Bearer $token")
            } else if (apiKey.isNotBlank()) {
                builder.header("X-Radio-Key", apiKey)
            }
            chain.proceed(builder.build())
        }

        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    fun channelsApi(
        baseUrl: String,
        authTokenProvider: () -> String,
        apiKeyProvider: () -> String,
    ): ChannelsApi = buildRetrofit(baseUrl, authTokenProvider, apiKeyProvider).create(ChannelsApi::class.java)

    fun radioApi(
        baseUrl: String,
        authTokenProvider: () -> String,
        apiKeyProvider: () -> String,
    ): RadioApi = buildRetrofit(baseUrl, authTokenProvider, apiKeyProvider).create(RadioApi::class.java)

    fun authApi(baseUrl: String): AuthApi =
        buildRetrofit(baseUrl, authTokenProvider = { "" }, apiKeyProvider = { "" }).create(AuthApi::class.java)
}
