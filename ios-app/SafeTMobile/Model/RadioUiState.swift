import Foundation

/// Immutable-ish snapshot of the radio shell. `RadioViewModel` is the source of truth.
struct RadioUiState {
    var systemTime = "--:--"
    var networkLabel = "SYNCING"
    var displayLine1 = "safeT PTT"
    var displayLine2 = "OPERATIONS"
    var channelLabel = "----"
    var channelPosition = "-- / --"
    var statusMessage = "STARTING"
    var isPttPressed = false
    var pttBusyTone = false
    var isEmergencyActive = false
    var channelsLoading = true
    var channelSyncError: String?
    var localShortUnitId = ""
    var operatorDisplayName = ""
    var agencyName = ""
    var radiosOnlineOnChannel: Int?
    var gpsActive = true
    var locationAuthorized = false
    /// True while the speaker is playing audio received from another unit.
    var isReceivingAudio = false
    /// True while the mic is hot and frames are being streamed to the server.
    var isTransmitting = false
    /// The server's permission grant for the current channel — gates the mic.
    var canTransmit = false
}
