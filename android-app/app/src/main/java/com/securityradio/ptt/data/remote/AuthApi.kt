package com.securityradio.ptt.data.remote

import retrofit2.http.Body
import retrofit2.http.POST

data class LoginRequestDto(
    val username: String,
    val password: String,
    val agency_slug: String,
)

data class SessionUserDto(
    val id: Int,
    val username: String,
    val displayName: String,
    val role: String,
    val unitId: String?,
    val agencyId: Int?,
    val agencyName: String?,
)

data class LoginResponseDto(
    val token: String,
    val user: SessionUserDto,
)

interface AuthApi {
    @POST("/v1/auth/login")
    suspend fun login(@Body body: LoginRequestDto): LoginResponseDto
}
