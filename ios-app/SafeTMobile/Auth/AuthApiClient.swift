import Foundation

/// The signed-in radio user, returned by `POST /v1/auth/login`.
struct AuthenticatedUser: Codable, Equatable {
    let id: Int
    let username: String
    let displayName: String
    let role: String
    let unitId: String?
    let agencyId: Int?
    let agencyName: String?

    /// Unit id the server uses on the voice WebSocket: explicit unitId if set,
    /// otherwise the uppercased username (matches voiceRelay's fallback rule).
    var radioUnitId: String {
        let trimmed = (unitId ?? "").trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return trimmed.uppercased() }
        return username.uppercased()
    }

    /// Whether this account can hit dispatcher-only endpoints (10-33 toggle,
    /// admin/operator features). Mirrors the server's `requireAgencyOperator`
    /// gate, which accepts both admin and dispatcher.
    var isOperator: Bool {
        role == "admin" || role == "dispatcher"
    }
}

enum AuthError: Error, LocalizedError {
    case missingCredentials
    case invalidLogin
    case server(Int)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .missingCredentials: return "Enter your username and password."
        case .invalidLogin: return "That username and password didn't work."
        case .server(let code): return "Server error (\(code)). Try again in a moment."
        case .network: return "Could not reach the server. Check your connection."
        }
    }
}

/// Talks to the `/v1/auth/*` endpoints. Unauthenticated — the token returned
/// from `login` is what every other API call uses.
final class AuthApiClient {
    private let baseURL: URL
    private let session: URLSession

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    init(baseURL: URL = RadioConfig.apiBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    struct LoginResponse: Decodable {
        let token: String
        let user: AuthenticatedUser
    }

    func login(username: String, password: String) async throws -> LoginResponse {
        let trimmedUser = username.trimmingCharacters(in: .whitespaces)
        let trimmedPass = password
        if trimmedUser.isEmpty || trimmedPass.isEmpty {
            throw AuthError.missingCredentials
        }

        var request = URLRequest(url: baseURL.appendingPathComponent("v1/auth/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["username": trimmedUser, "password": trimmedPass])

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AuthError.network(error)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        switch status {
        case 200..<300:
            return try decoder.decode(LoginResponse.self, from: data)
        case 400, 401, 403:
            throw AuthError.invalidLogin
        default:
            throw AuthError.server(status)
        }
    }
}
