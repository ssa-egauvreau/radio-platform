package com.securityradio.ptt.data.remote

import com.google.gson.annotations.SerializedName
import retrofit2.http.GET

interface ChannelsApi {
    @GET("v1/channels")
    suspend fun channels(): ChannelsResponseDto

    @GET("v1/air")
    suspend fun airState(): AirStateDto

    /** Optional telemetry for who is keyed on primary vs scan channels (mock via Railway env vars). */
    @GET("v1/talk-activity")
    suspend fun talkActivity(): TalkActivityDto
}

data class TalkActivityDto(
    @SerializedName("main") val main: TalkerSnapshotDto? = null,
    @SerializedName("scan") val scan: TalkerSnapshotDto? = null,
)

data class TalkerSnapshotDto(
    @SerializedName("channel") val channel: String = "",
    @SerializedName("active") val active: Boolean = false,
    @SerializedName("unit_id") val unitId: String? = null,
    @SerializedName("username") val username: String? = null,
)

data class ChannelsResponseDto(
    @SerializedName("channels") val channels: List<ChannelDto>,
)

data class ChannelDto(
    @SerializedName("id") val id: Int,
    @SerializedName("name") val name: String,
)

data class AirStateDto(
    @SerializedName("occupied") val occupied: Boolean,
)
