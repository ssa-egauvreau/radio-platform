import Foundation

/// Holds the signed-in user and JWT, persists them in the Keychain across
/// launches, and is the single source of truth `RootView` watches to decide
/// whether to show the login screen or the radio.
@MainActor
final class AuthSession: ObservableObject {
    @Published private(set) var currentUser: AuthenticatedUser?
    @Published private(set) var token: String?
    @Published private(set) var isLoggingIn = false
    @Published var loginError: String?

    private let api: AuthApiClient
    private let keychain: KeychainStore

    init(api: AuthApiClient = AuthApiClient(), keychain: KeychainStore = KeychainStore()) {
        self.api = api
        self.keychain = keychain
        restoreFromKeychain()
    }

    private struct Stored: Codable {
        let token: String
        let user: AuthenticatedUser
    }

    private func restoreFromKeychain() {
        guard let data = keychain.read() else { return }
        guard let stored = try? JSONDecoder().decode(Stored.self, from: data) else {
            keychain.delete()
            return
        }
        token = stored.token
        currentUser = stored.user
    }

    func login(username: String, password: String) async {
        isLoggingIn = true
        loginError = nil
        defer { isLoggingIn = false }
        do {
            let response = try await api.login(username: username, password: password)
            persist(token: response.token, user: response.user)
        } catch let error as AuthError {
            loginError = error.errorDescription
        } catch {
            loginError = AuthError.network(error).errorDescription
        }
    }

    func logout() {
        keychain.delete()
        token = nil
        currentUser = nil
        loginError = nil
    }

    private func persist(token: String, user: AuthenticatedUser) {
        if let data = try? JSONEncoder().encode(Stored(token: token, user: user)) {
            keychain.write(data)
        }
        self.token = token
        currentUser = user
    }
}

#if DEBUG
extension AuthSession {
    /// Test-only hook: stub a signed-in user so UI tests can render the radio
    /// screen without hitting the server. Triggered by `-uitest-logged-in`.
    static func forUITesting() -> AuthSession {
        let session = AuthSession(api: AuthApiClient(), keychain: KeychainStore(service: "ui-test", account: "ui-test"))
        session.token = "ui-test-token"
        session.currentUser = AuthenticatedUser(
            id: 0,
            username: "uitester",
            displayName: "UI Tester",
            role: "radio",
            unitId: "UITEST",
            agencyId: 0,
            agencyName: "UI Test Agency"
        )
        return session
    }
}
#endif
