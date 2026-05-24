import SwiftUI

/// Browse + search recent recorded transmissions and play back the WAV.
/// Backed by `GET /v1/transmissions` (filtered server-side by `search` query
/// param) and `GET /v1/transmissions/:id/audio` for playback.
///
/// Reloads on appear and on pull-to-refresh. No live polling — operators
/// review past traffic episodically, so a manual refresh model is enough
/// and keeps battery / data usage down.
struct TranscriptionsScreen: View {
    let api: RadioApiClient

    @StateObject private var player = TranscriptionPlayer()
    @State private var transmissions: [Transmission] = []
    @State private var search = ""
    @State private var loading = false
    @State private var error: String?
    @State private var loadingAudioId: Int?

    /// Debounce the search input so we don't fire a request on every keystroke.
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            searchBar
            content
        }
        .background(Color.safetBackground.ignoresSafeArea())
        .navigationTitle("TRANSCRIPTS")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.safetTextDim)
            TextField("Search transcript text", text: $search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundColor(.safetText)
                .onChange(of: search) { _ in scheduleSearch() }
            if !search.isEmpty {
                Button {
                    search = ""
                    scheduleSearch()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.safetTextDim)
                }
            }
        }
        .padding(10)
        .background(Color.safetSurface)
        .overlay(Rectangle().frame(height: 1).foregroundColor(.safetBorder), alignment: .bottom)
    }

    @ViewBuilder
    private var content: some View {
        if loading && transmissions.isEmpty {
            ProgressView()
                .tint(.safetText)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error, transmissions.isEmpty {
            VStack(spacing: 12) {
                Text("CAN'T LOAD TRANSCRIPTS")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundColor(.safetRed)
                Text(error)
                    .font(.system(size: 11))
                    .foregroundColor(.safetTextDim)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Button("RETRY") { Task { await reload() } }
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.safetText)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if transmissions.isEmpty {
            Text(search.isEmpty ? "NO RECENT TRANSMISSIONS" : "NO MATCHES")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.safetTextDim)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            list
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(transmissions) { tx in
                    row(tx)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .refreshable { await reload() }
    }

    private func row(_ tx: Transmission) -> some View {
        let isPlaying = player.playingId == tx.id
        let isLoadingAudio = loadingAudioId == tx.id
        return Button {
            handleTap(tx)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                playIcon(isPlaying: isPlaying, isLoading: isLoadingAudio)
                    .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(tx.channelName)
                            .font(.system(size: 11, weight: .heavy, design: .monospaced))
                            .foregroundColor(.safetSignal)
                        Spacer()
                        Text(formatTime(tx.startedAt))
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundColor(.safetTextDim)
                    }
                    HStack(spacing: 6) {
                        Text(tx.unitId ?? "?")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(.safetText)
                        if let name = tx.displayName, !name.isEmpty {
                            Text("• \(name)")
                                .font(.system(size: 10))
                                .foregroundColor(.safetTextDim)
                        }
                        Spacer()
                        Text(formatDuration(tx.durationMs))
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundColor(.safetTextDim)
                    }
                    transcriptLine(tx)
                }
            }
            .padding(10)
            .background(Color.safetSurface)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.safetBorder, lineWidth: 1))
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func playIcon(isPlaying: Bool, isLoading: Bool) -> some View {
        if isLoading {
            ProgressView().tint(.safetText)
        } else {
            Image(systemName: isPlaying ? "stop.circle.fill" : "play.circle.fill")
                .resizable()
                .foregroundColor(isPlaying ? .safetRed : .safetGreen)
        }
    }

    @ViewBuilder
    private func transcriptLine(_ tx: Transmission) -> some View {
        switch tx.transcriptStatus {
        case "done":
            if let text = tx.transcript, !text.isEmpty {
                Text(text)
                    .font(.system(size: 12))
                    .foregroundColor(.safetText)
                    .multilineTextAlignment(.leading)
            } else {
                Text("(no speech detected)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.safetTextDim)
            }
        case "pending":
            Text("TRANSCRIBING…")
                .font(.system(size: 10, weight: .heavy, design: .monospaced))
                .foregroundColor(.safetAmber)
        case "error":
            Text("TRANSCRIPT FAILED")
                .font(.system(size: 10, weight: .heavy, design: .monospaced))
                .foregroundColor(.safetRed)
        default:
            EmptyView()
        }
    }

    // MARK: - actions

    private func handleTap(_ tx: Transmission) {
        if player.playingId == tx.id {
            player.stop()
            return
        }
        Task { await loadAndPlay(tx) }
    }

    private func loadAndPlay(_ tx: Transmission) async {
        loadingAudioId = tx.id
        defer { loadingAudioId = nil }
        do {
            let data = try await api.transmissionAudio(id: tx.id)
            player.play(id: tx.id, data: data)
        } catch {
            self.error = "Couldn't load audio: \(error.localizedDescription)"
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        let snapshot = search
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled, snapshot == search else { return }
            await reload()
        }
    }

    private func reload() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            transmissions = try await api.transmissions(search: search.isEmpty ? nil : search)
        } catch {
            self.error = "\(error)"
        }
    }

    // MARK: - formatting

    private static let serverDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let serverDateFormatterFallback: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
    private static let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d HH:mm:ss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    private func formatTime(_ raw: String) -> String {
        let date = Self.serverDateFormatter.date(from: raw) ?? Self.serverDateFormatterFallback.date(from: raw)
        guard let date else { return raw }
        return Self.displayFormatter.string(from: date)
    }

    private func formatDuration(_ ms: Int) -> String {
        let seconds = max(0, ms) / 1000
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }
}
